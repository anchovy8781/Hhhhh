import unittest

from powerdev.clock import FakeClock
from powerdev.device import PowerSupply
from powerdev.drivers import Driver
from powerdev.errors import PowerDevError, ProtectionTripped


class SupplyTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.psu = PowerSupply.connect("sim://psu?channels=2&load=10",
                                       clock=self.clock)
        self.addCleanup(self.psu.close)

    def test_identity_is_split_out_of_the_idn(self):
        self.assertEqual(self.psu.vendor, "PowerDev")
        self.assertEqual(self.psu.model, "SIM-PSU-2CH")
        self.assertEqual(self.psu.channel_count, 2)
        self.assertEqual(len(self.psu), 2)

    def test_configure_then_measure(self):
        self.psu[1].configure(voltage=5.0, current=1.0).on()
        reading = self.psu[1].measure()
        self.assertAlmostEqual(reading.voltage, 5.0)
        self.assertAlmostEqual(reading.current, 0.5)
        self.assertAlmostEqual(reading.power, 2.5)
        self.assertEqual(reading.mode, "CV")
        self.assertEqual(reading.timestamp, self.clock.wall())

    def test_status_reports_setpoints_and_measurement(self):
        self.psu[2].configure(voltage=2.0, current=0.4).on()
        status = self.psu[2].status()
        self.assertTrue(status.output)
        self.assertAlmostEqual(status.voltage_set, 2.0)
        self.assertAlmostEqual(status.current_limit, 0.4)
        self.assertAlmostEqual(status.reading.voltage, 2.0)
        self.assertIn("measured", status.as_dict())

    def test_current_limit_shows_up_as_cc_mode(self):
        self.psu.client.write("SIM:LOAD1 2")
        self.psu[1].configure(voltage=10.0, current=1.0).on()
        reading = self.psu[1].measure()
        self.assertEqual(reading.mode, "CC")
        self.assertAlmostEqual(reading.current, 1.0)

    def test_protection_trip_is_detected_and_clearable(self):
        self.psu[1].set_ovp(3.0)
        self.psu[1].configure(voltage=5.0).on()
        self.assertEqual(self.psu[1].protection_tripped(), "ovp")
        with self.assertRaises(ProtectionTripped) as caught:
            self.psu[1].raise_if_tripped()
        self.assertEqual(caught.exception.channel, 1)
        self.psu[1].configure(voltage=1.0)
        self.psu[1].clear_protection()
        self.assertIsNone(self.psu[1].protection_tripped())

    def test_all_outputs_off(self):
        for channel in self.psu:
            channel.configure(voltage=1.0).on()
        self.assertEqual(self.psu.all_outputs_off(), [])
        self.assertFalse(any(c.output for c in self.psu))

    def test_out_of_range_channel_is_rejected(self):
        with self.assertRaises(PowerDevError):
            self.psu.channel(9)

    def test_measure_all_falls_back_to_single_queries(self):
        class NoCombinedQuery(Driver):
            def measure_all(self, channel):
                return None

        self.psu.driver = NoCombinedQuery(channels=2)
        self.psu[1].configure(voltage=4.0, current=1.0).on()
        reading = self.psu[1].measure()
        self.assertAlmostEqual(reading.voltage, 4.0)
        self.assertAlmostEqual(reading.power, 4.0 * 0.4)

    def test_context_manager_closes_the_link(self):
        with PowerSupply.connect("sim://psu") as psu:
            transport = psu.client.transport
            self.assertTrue(transport.is_open)
        self.assertFalse(transport.is_open)


if __name__ == "__main__":
    unittest.main()
