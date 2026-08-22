import unittest

from powerdev.errors import DeviceError
from powerdev.scpi import ScpiClient
from powerdev.transports import open_transport


class ScpiClientTests(unittest.TestCase):
    def setUp(self):
        self.transport = open_transport("sim://psu?channels=2")
        self.addCleanup(self.transport.close)
        self.client = ScpiClient(self.transport)

    def test_idn_and_numeric_queries(self):
        self.assertIn("SIM-PSU-2CH", self.client.idn())
        self.client.write("SOUR1:VOLT 4.5")
        self.assertAlmostEqual(self.client.query_float("SOUR1:VOLT?"), 4.5)

    def test_query_floats_splits_a_compound_response(self):
        self.client.write("APPL CH1,6,1")
        self.client.write("OUTP1 ON")
        values = self.client.query_floats("MEAS:ALL? CH1")
        self.assertEqual(len(values), 3)
        self.assertAlmostEqual(values[0], 6.0)

    def test_query_bool_understands_on_and_one(self):
        self.assertFalse(self.client.query_bool("OUTP1?"))
        self.client.write("OUTP1 ON")
        self.assertTrue(self.client.query_bool("OUTP1?"))

    def test_error_checking_turns_a_rejected_command_into_an_exception(self):
        with self.assertRaises(DeviceError) as caught:
            self.client.write("SOUR1:VOLT 999")
        self.assertEqual(caught.exception.code, -222)

    def test_error_checking_can_be_disabled(self):
        client = ScpiClient(self.transport, check_errors=False)
        client.write("SOUR1:VOLT 999")  # no exception
        self.assertEqual(client.drain_errors()[0][0], -222)

    def test_drain_errors_returns_the_whole_queue(self):
        client = ScpiClient(self.transport, check_errors=False)
        client.write("BAD:ONE 1")
        client.write("BAD:TWO 2")
        self.assertEqual(len(client.drain_errors()), 2)

    def test_non_numeric_response_is_reported_clearly(self):
        with self.assertRaises(DeviceError):
            self.client.query_float("*IDN?")

    def test_trace_hook_sees_both_directions(self):
        seen = []
        self.client.trace = lambda direction, text: seen.append((direction, text))
        self.client.idn()
        self.assertEqual(seen[0][0], ">")
        self.assertEqual(seen[1][0], "<")


if __name__ == "__main__":
    unittest.main()
