import json
import os
import tempfile
import unittest

from powerdev.clock import FakeClock
from powerdev.device import PowerSupply
from powerdev.errors import SequenceError
from powerdev.sequence import SequenceRunner, load_sequence, run_sequence, validate_sequence


def spec(*steps, **extra):
    data = {"name": "test", "steps": list(steps)}
    data.update(extra)
    return data


class ValidationTests(unittest.TestCase):
    def test_steps_must_exist(self):
        with self.assertRaises(SequenceError):
            validate_sequence({"name": "empty", "steps": []})

    def test_unknown_op_is_named_in_the_error(self):
        with self.assertRaises(SequenceError) as caught:
            validate_sequence(spec({"op": "explode"}))
        self.assertIn("explode", str(caught.exception))

    def test_top_level_must_be_an_object(self):
        with self.assertRaises(SequenceError):
            validate_sequence([{"op": "log"}])

    def test_missing_file(self):
        with self.assertRaises(SequenceError):
            load_sequence("/nonexistent/sequence.json")

    def test_invalid_json_is_reported_with_the_path(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            handle.write("{not json")
            path = handle.name
        self.addCleanup(os.unlink, path)
        with self.assertRaises(SequenceError) as caught:
            load_sequence(path)
        self.assertIn(path, str(caught.exception))

    def test_a_real_sequence_file_loads(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(spec({"op": "log", "message": "hi"}), handle)
            path = handle.name
        self.addCleanup(os.unlink, path)
        self.assertEqual(load_sequence(path)["steps"][0]["message"], "hi")


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.psu = PowerSupply.connect("sim://psu?channels=2&load=10",
                                       clock=self.clock)
        self.addCleanup(self.psu.close)

    def run_spec(self, data, **kwargs):
        return run_sequence(data, self.psu, clock=self.clock, **kwargs)

    def test_set_output_and_check_pass(self):
        report = self.run_spec(spec(
            {"op": "set", "channel": 1, "voltage": 5.0, "current": 1.0},
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "check", "channel": 1,
             "voltage": {"nominal": 5.0, "tolerance_pct": 1},
             "current": {"max": 0.6}, "mode": "CV"},
        ))
        self.assertTrue(report.passed)
        self.assertEqual([s.status for s in report.steps], ["pass"] * 3)

    def test_failing_check_stops_the_run(self):
        report = self.run_spec(spec(
            {"op": "set", "channel": 1, "voltage": 1.0},
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "check", "channel": 1, "voltage": {"min": 4.0}},
            {"op": "log", "message": "unreachable"},
        ))
        self.assertFalse(report.passed)
        self.assertEqual(len(report.steps), 3)
        self.assertEqual(report.failures[0].status, "fail")

    def test_continue_on_fail_runs_every_step(self):
        report = self.run_spec(spec(
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "check", "channel": 1, "voltage": {"min": 99.0}},
            {"op": "log", "message": "still runs"},
        ), stop_on_fail=False)
        self.assertEqual(len(report.steps), 3)
        self.assertFalse(report.passed)

    def test_outputs_are_switched_off_after_a_failure(self):
        self.run_spec(spec(
            {"op": "set", "channel": 1, "voltage": 5.0},
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "check", "channel": 1, "voltage": {"min": 99.0}},
        ))
        self.assertFalse(self.psu[1].output)

    def test_no_shutdown_leaves_the_output_on(self):
        report = self.run_spec(spec(
            {"op": "set", "channel": 1, "voltage": 5.0},
            {"op": "output", "channel": 1, "state": "on"},
        ), safe_shutdown=False)
        self.assertTrue(self.psu[1].output)
        self.assertFalse(report.shutdown_performed)

    def test_wait_advances_the_clock_only(self):
        report = self.run_spec(spec({"op": "wait", "seconds": 2.5}))
        self.assertEqual(self.clock.sleeps, [2.5])
        self.assertAlmostEqual(report.duration, 2.5)

    def test_ramp_walks_the_setpoint_and_records_readings(self):
        report = self.run_spec(spec(
            {"op": "set", "channel": 1, "current": 3.0},
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "ramp", "channel": 1, "from": 0, "to": 10, "seconds": 1,
             "steps": 5},
        ), safe_shutdown=False)
        ramp = report.steps[-1]
        self.assertEqual(len(ramp.readings), 5)
        self.assertAlmostEqual(ramp.readings[-1].voltage, 10.0)
        self.assertAlmostEqual(self.psu[1].voltage_setpoint, 10.0)

    def test_ramp_without_a_target_is_an_error(self):
        report = self.run_spec(spec({"op": "ramp", "channel": 1, "from": 0}))
        self.assertEqual(report.steps[0].status, "error")

    def test_measure_step_records_every_named_channel(self):
        report = self.run_spec(spec({"op": "measure", "channels": [1, 2]}))
        self.assertEqual([r.channel for r in report.steps[0].readings], [1, 2])

    def test_check_with_nothing_to_check_is_an_error(self):
        report = self.run_spec(spec({"op": "check", "channel": 1}))
        self.assertEqual(report.steps[0].status, "error")

    def test_load_step_is_skipped_on_a_driver_without_a_simulated_load(self):
        from powerdev.drivers import Driver

        self.psu.driver = Driver(channels=2)  # generic SCPI: no simulated load
        report = self.run_spec(spec({"op": "load", "channel": 1, "ohms": 5}))
        self.assertEqual(report.steps[0].status, "skip")
        self.assertTrue(report.passed)

    def test_protection_trip_during_a_step_is_reported_not_raised(self):
        report = self.run_spec(spec(
            {"op": "set", "channel": 1, "voltage": 5.0, "ovp": 3.0},
            {"op": "output", "channel": 1, "state": "on"},
            {"op": "check", "channel": 1, "voltage": {"nominal": 5.0,
                                                      "tolerance": 0.1}},
        ))
        self.assertFalse(report.passed)
        self.assertIn("outside", report.failures[0].detail)

    def test_on_step_callback_is_invoked_in_order(self):
        seen = []
        SequenceRunner(self.psu, clock=self.clock,
                       on_step=lambda step: seen.append(step.index)).run(
            spec({"op": "log", "message": "a"}, {"op": "log", "message": "b"}))
        self.assertEqual(seen, [1, 2])

    def test_report_serialises_to_json(self):
        report = self.run_spec(spec({"op": "measure", "channel": 1}))
        payload = json.loads(json.dumps(report.as_dict()))
        self.assertTrue(payload["passed"])
        self.assertEqual(payload["steps"][0]["op"], "measure")


class ExampleSequenceTests(unittest.TestCase):
    """The shipped examples must keep working."""

    def _run(self, filename):
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)),
                            "examples", filename)
        data = load_sequence(path)
        clock = FakeClock()
        with PowerSupply.connect(data["device"], clock=clock) as psu:
            return run_sequence(data, psu, clock=clock)

    def test_bringup_example_passes(self):
        self.assertTrue(self._run("3v3_bringup.json").passed)

    def test_ramp_example_passes(self):
        self.assertTrue(self._run("ramp_to_current_limit.json").passed)


if __name__ == "__main__":
    unittest.main()
