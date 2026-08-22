import io
import json
import unittest

from powerdev.clock import FakeClock
from powerdev.device import PowerSupply
from powerdev.errors import PowerDevError
from powerdev.monitor import CsvWriter, JsonlWriter, Monitor, make_writer, summarize


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.psu = PowerSupply.connect("sim://psu?channels=2&load=5",
                                       clock=self.clock)
        self.addCleanup(self.psu.close)
        self.psu[1].configure(voltage=5.0, current=2.0).on()

    def test_count_limit(self):
        samples = Monitor(self.psu, channels=[1], interval=0.25, count=4,
                          clock=self.clock).run()
        self.assertEqual(len(samples), 4)
        self.assertEqual([s.elapsed for s in samples], [0.0, 0.25, 0.5, 0.75])

    def test_duration_limit_includes_the_final_sample(self):
        samples = Monitor(self.psu, channels=[1], interval=0.5, duration=1.0,
                          clock=self.clock).run()
        self.assertEqual([s.elapsed for s in samples], [0.0, 0.5, 1.0])

    def test_schedule_does_not_drift_when_a_read_is_slow(self):
        clock = self.clock
        original = self.psu.channel(1).measure

        def slow_measure(*args, **kwargs):
            clock.sleep(0.1)  # instrument takes 100 ms to answer
            return original(*args, **kwargs)

        self.psu.channels[0].measure = slow_measure
        samples = Monitor(self.psu, channels=[1], interval=0.25, count=3,
                          clock=clock).run()
        self.assertEqual([s.elapsed for s in samples], [0.0, 0.25, 0.5])

    def test_multiple_channels_per_sample(self):
        samples = Monitor(self.psu, channels=[1, 2], interval=0.1, count=2,
                          clock=self.clock).run()
        self.assertEqual([r.channel for r in samples[0].readings], [1, 2])
        self.assertAlmostEqual(samples[0].by_channel(1).current, 1.0)

    def test_callback_sees_every_sample(self):
        seen = []
        Monitor(self.psu, channels=[1], interval=0.1, count=3,
                clock=self.clock).run(callback=seen.append)
        self.assertEqual(len(seen), 3)

    def test_zero_interval_is_rejected(self):
        with self.assertRaises(PowerDevError):
            Monitor(self.psu, interval=0)

    def test_bad_channel_is_rejected_before_sampling(self):
        with self.assertRaises(PowerDevError):
            Monitor(self.psu, channels=[7], interval=1)


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.psu = PowerSupply.connect("sim://psu?channels=1&load=5",
                                       clock=self.clock)
        self.addCleanup(self.psu.close)
        self.psu[1].configure(voltage=5.0, current=2.0).on()
        self.samples = Monitor(self.psu, channels=[1], interval=1.0, count=4,
                               clock=self.clock).run()

    def test_statistics(self):
        summary = summarize(self.samples)[1]
        self.assertEqual(summary["samples"], 4)
        self.assertAlmostEqual(summary["voltage"]["mean"], 5.0)
        self.assertAlmostEqual(summary["current"]["max"], 1.0)
        self.assertAlmostEqual(summary["duration_s"], 3.0)

    def test_energy_is_integrated_over_time(self):
        # 5 W held for 3 s == 15 Ws == 15/3600 Wh.
        self.assertAlmostEqual(summarize(self.samples)[1]["energy_wh"], 15 / 3600.0)

    def test_empty_input(self):
        self.assertEqual(summarize([]), {})


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.psu = PowerSupply.connect("sim://psu?channels=2&load=5",
                                       clock=self.clock)
        self.addCleanup(self.psu.close)
        self.psu[1].configure(voltage=5.0, current=2.0).on()
        self.samples = Monitor(self.psu, channels=[1, 2], interval=0.5, count=2,
                               clock=self.clock).run()

    def test_csv_header_and_rows(self):
        buffer = io.StringIO()
        writer = CsvWriter(buffer, [1, 2])
        for sample in self.samples:
            writer.write(sample)
        lines = buffer.getvalue().strip().splitlines()
        self.assertEqual(
            lines[0],
            "sample,elapsed_s,timestamp,ch1_v,ch1_i,ch1_p,ch2_v,ch2_i,ch2_p")
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[1].startswith("0,0.000000,"))

    def test_jsonl_rows_are_self_describing(self):
        buffer = io.StringIO()
        writer = JsonlWriter(buffer, [1, 2])
        for sample in self.samples:
            writer.write(sample)
        first = json.loads(buffer.getvalue().splitlines()[0])
        self.assertEqual(first["sample"], 0)
        self.assertAlmostEqual(first["channels"]["1"]["voltage"], 5.0)

    def test_unknown_format_is_reported(self):
        with self.assertRaises(PowerDevError):
            make_writer("parquet", io.StringIO(), [1])


if __name__ == "__main__":
    unittest.main()
