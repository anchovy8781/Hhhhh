import contextlib
import io
import json
import os
import tempfile
import unittest

from powerdev.cli import main

SIM = "sim://psu?channels=2&load=10&v=5&i=1&on=1"


def run_cli(*argv):
    """Run the CLI, returning ``(exit_code, stdout, stderr)``."""
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = main(list(argv))
    return code, out.getvalue(), err.getvalue()


class IdentityTests(unittest.TestCase):
    def test_id_reports_the_detected_driver(self):
        code, out, _ = run_cli("-d", SIM, "id")
        self.assertEqual(code, 0)
        self.assertIn("SIM-PSU-2CH", out)
        self.assertIn("sim-psu", out)

    def test_id_json(self):
        code, out, _ = run_cli("-d", SIM, "id", "--json")
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(payload["channels"], 2)
        self.assertEqual(payload["driver"], "sim-psu")

    def test_drivers_lists_the_generic_fallback(self):
        code, out, _ = run_cli("drivers")
        self.assertEqual(code, 0)
        self.assertIn("generic", out)
        self.assertIn("rigol-dp800", out)

    def test_no_command_prints_help(self):
        code, out, _ = run_cli()
        self.assertEqual(code, 1)
        self.assertIn("usage:", out)


class ControlTests(unittest.TestCase):
    def test_set_applies_and_reports(self):
        code, out, _ = run_cli("-d", SIM, "set", "-c", "1", "-V", "3.3",
                               "-I", "0.5", "--on")
        self.assertEqual(code, 0)
        self.assertIn("3.300", out)
        self.assertIn("ON", out)

    def test_status_covers_every_channel(self):
        code, out, _ = run_cli("-d", SIM, "status")
        lines = [line for line in out.strip().splitlines() if line.strip()]
        self.assertEqual(code, 0)
        self.assertEqual(len(lines), 3)  # header + 2 channels

    def test_status_json_is_machine_readable(self):
        code, out, _ = run_cli("-d", SIM, "status", "--json")
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(payload[0]["channel"], 1)
        self.assertIn("measured", payload[0])

    def test_measure_json(self):
        code, out, _ = run_cli("-d", SIM, "measure", "-c", "1", "--json")
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertAlmostEqual(payload[0]["voltage"], 5.0)
        self.assertAlmostEqual(payload[0]["current"], 0.5)

    def test_off_switches_every_channel(self):
        code, out, _ = run_cli("-d", SIM, "off")
        self.assertEqual(code, 0)
        self.assertNotIn(" ON ", out)

    def test_scpi_query_prints_the_reply(self):
        code, out, _ = run_cli("-d", SIM, "scpi", "*IDN?")
        self.assertEqual(code, 0)
        self.assertIn("PowerDev,", out)

    def test_verbose_traces_to_stderr(self):
        code, _, err = run_cli("-d", SIM, "-v", "scpi", "SOUR1:VOLT?")
        self.assertEqual(code, 0)
        self.assertIn("> SOUR1:VOLT?", err)

    def test_bad_channel_is_a_clean_error(self):
        code, _, err = run_cli("-d", SIM, "measure", "-c", "9")
        self.assertEqual(code, 1)
        self.assertIn("out of range", err)

    def test_unsupported_device_url_is_a_clean_error(self):
        code, _, err = run_cli("-d", "gpib://7", "id")
        self.assertEqual(code, 1)
        self.assertIn("unsupported device URL", err)

    def test_rejected_setpoint_surfaces_the_instrument_error(self):
        code, _, err = run_cli("-d", SIM, "set", "-c", "1", "-V", "999")
        self.assertEqual(code, 1)
        self.assertIn("out of range", err.lower())


class MonitorCommandTests(unittest.TestCase):
    def test_monitor_writes_a_csv_log(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "log.csv")
            code, out, err = run_cli("-d", SIM, "monitor", "-c", "1",
                                     "-n", "3", "-i", "0.01", "-o", path)
            self.assertEqual(code, 0)
            with open(path) as handle:
                lines = handle.read().strip().splitlines()
        self.assertEqual(lines[0], "sample,elapsed_s,timestamp,ch1_v,ch1_i,ch1_p")
        self.assertEqual(len(lines), 4)
        self.assertIn("wrote 3 samples", err)

    def test_monitor_jsonl_format_from_the_extension(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "log.jsonl")
            code, _, _ = run_cli("-d", SIM, "monitor", "-c", "1", "-n", "2",
                                 "-i", "0.01", "-o", path, "-q")
            self.assertEqual(code, 0)
            with open(path) as handle:
                rows = [json.loads(line) for line in handle if line.strip()]
        self.assertEqual(len(rows), 2)
        self.assertAlmostEqual(rows[0]["channels"]["1"]["voltage"], 5.0)

    def test_monitor_stats_summary(self):
        code, out, _ = run_cli("-d", SIM, "monitor", "-c", "1", "-n", "3",
                               "-i", "0.01", "-q", "--stats")
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(payload["1"]["samples"], 3)
        self.assertIn("energy_wh", payload["1"])


class RunCommandTests(unittest.TestCase):
    def _write(self, spec):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(spec, handle)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return handle.name

    def test_passing_sequence_exits_zero(self):
        path = self._write({
            "name": "ok",
            "device": "sim://psu?channels=1&load=10",
            "steps": [
                {"op": "set", "channel": 1, "voltage": 5.0, "current": 1.0},
                {"op": "output", "channel": 1, "state": "on"},
                {"op": "check", "channel": 1, "voltage": {"nominal": 5.0,
                                                          "tolerance": 0.05}},
            ],
        })
        code, out, _ = run_cli("run", path)
        self.assertEqual(code, 0)
        self.assertIn("PASS", out)

    def test_failing_sequence_exits_two(self):
        path = self._write({
            "name": "bad",
            "device": "sim://psu?channels=1&load=10",
            "steps": [
                {"op": "set", "channel": 1, "voltage": 1.0},
                {"op": "output", "channel": 1, "state": "on"},
                {"op": "check", "channel": 1, "voltage": {"min": 4.0}},
            ],
        })
        code, out, _ = run_cli("run", path)
        self.assertEqual(code, 2)
        self.assertIn("FAIL", out)

    def test_report_json(self):
        path = self._write({
            "name": "json report",
            "device": "sim://psu?channels=1",
            "steps": [{"op": "log", "message": "hello"}],
        })
        code, out, _ = run_cli("run", path, "--json")
        payload = json.loads(out)
        self.assertEqual(code, 0)
        self.assertTrue(payload["passed"])
        self.assertTrue(payload["shutdown_performed"])

    def test_device_flag_overrides_the_sequence_file(self):
        path = self._write({
            "name": "channel count",
            "device": "sim://psu?channels=1",
            "steps": [{"op": "measure", "channels": [1, 2, 3]}],
        })
        code, _, _ = run_cli("-d", "sim://psu?channels=3", "run", path)
        self.assertEqual(code, 0)

    def test_missing_sequence_file_is_a_clean_error(self):
        code, _, err = run_cli("run", "/nonexistent/seq.json")
        self.assertEqual(code, 1)
        self.assertIn("sequence error", err)


class EnvironmentTests(unittest.TestCase):
    def test_device_defaults_to_the_environment_variable(self):
        from powerdev import cli

        os.environ["POWERDEV_DEVICE"] = "sim://psu?channels=4"
        self.addCleanup(os.environ.pop, "POWERDEV_DEVICE", None)
        self.assertEqual(cli.default_device(), "sim://psu?channels=4")
        code, out, _ = run_cli("id", "--json")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["channels"], 4)


if __name__ == "__main__":
    unittest.main()
