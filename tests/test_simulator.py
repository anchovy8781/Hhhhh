import math
import unittest

from powerdev.simulator import SimulatedSupply


class NormalizationTests(unittest.TestCase):
    def test_long_form_is_folded_to_short_form(self):
        head, is_query, args = SimulatedSupply._normalize(":SOURce1:VOLTage 3.30")
        self.assertEqual(head, "SOUR1:VOLT")
        self.assertFalse(is_query)
        self.assertEqual(args, "3.30")

    def test_query_flag_and_arguments(self):
        head, is_query, args = SimulatedSupply._normalize("MEASure:CURRent? CH2")
        self.assertEqual(head, "MEAS:CURR")
        self.assertTrue(is_query)
        self.assertEqual(args, "CH2")


class SupplyTests(unittest.TestCase):
    def setUp(self):
        self.supply = SimulatedSupply(channels=2, load_ohms=10.0)

    def test_idn_reports_channel_count(self):
        self.assertEqual(self.supply.execute("*IDN?"),
                         "PowerDev,SIM-PSU-2CH,SN0000001,1.0.0")
        self.assertEqual(self.supply.execute("SYST:CHAN?"), "2")

    def test_setpoints_round_trip(self):
        self.supply.execute("SOUR1:VOLT 5")
        self.supply.execute("SOUR1:CURR 1.25")
        self.assertEqual(float(self.supply.execute("SOUR1:VOLT?")), 5.0)
        self.assertEqual(float(self.supply.execute("SOUR1:CURR?")), 1.25)

    def test_output_off_measures_zero(self):
        self.supply.execute("SOUR1:VOLT 5")
        self.assertEqual(self.supply.execute("MEAS:ALL? CH1"), "0.0000,0.0000,0.0000")

    def test_constant_voltage_follows_ohms_law(self):
        self.supply.execute("APPL CH1,5.0,2.0")
        self.supply.execute("OUTP1 ON")
        voltage, current, power = [
            float(x) for x in self.supply.execute("MEAS:ALL? CH1").split(",")]
        self.assertAlmostEqual(voltage, 5.0)
        self.assertAlmostEqual(current, 0.5)
        self.assertAlmostEqual(power, 2.5)
        self.assertEqual(self.supply.execute("SIM:MODE1?"), "CV")

    def test_current_limit_folds_back_the_voltage(self):
        self.supply.execute("SIM:LOAD1 2")
        self.supply.execute("APPL CH1,10,1.0")
        self.supply.execute("OUTP1 ON")
        voltage, current, _ = [
            float(x) for x in self.supply.execute("MEAS:ALL? CH1").split(",")]
        self.assertAlmostEqual(current, 1.0)
        self.assertAlmostEqual(voltage, 2.0)
        self.assertEqual(self.supply.execute("SIM:MODE1?"), "CC")

    def test_open_circuit_draws_no_current(self):
        self.supply.execute("SIM:LOAD1 INF")
        self.supply.execute("SOUR1:VOLT 12")
        self.supply.execute("OUTP1 ON")
        self.assertEqual(self.supply.channel(1).load_ohms, math.inf)
        voltage, current, _ = [
            float(x) for x in self.supply.execute("MEAS:ALL? CH1").split(",")]
        self.assertAlmostEqual(voltage, 12.0)
        self.assertAlmostEqual(current, 0.0)

    def test_ovp_latches_and_kills_the_output(self):
        self.supply.execute("SOUR1:VOLT:PROT 4.0")
        self.supply.execute("SOUR1:VOLT:PROT:STAT ON")
        self.supply.execute("SOUR1:VOLT 5.0")
        self.supply.execute("OUTP1 ON")
        self.assertEqual(self.supply.execute("SOUR1:VOLT:PROT:TRIP?"), "1")
        self.assertEqual(self.supply.execute("OUTP1?"), "0")
        self.assertEqual(self.supply.execute("MEAS:VOLT? CH1"), "0.0000")

    def test_output_cannot_be_re_enabled_while_latched(self):
        self.supply.execute("SOUR1:CURR:PROT 0.1")
        self.supply.execute("SOUR1:CURR:PROT:STAT ON")
        self.supply.execute("SOUR1:VOLT 5.0")
        self.supply.execute("OUTP1 ON")
        self.supply.execute("MEAS:CURR? CH1")
        self.supply.execute("OUTP1 ON")
        self.assertEqual(self.supply.execute("OUTP1?"), "0")
        self.assertIn("-224", self.supply.execute("SYST:ERR?"))
        # Clearing the latch without fixing the overload simply re-trips.
        self.supply.execute("PROT1:CLE")
        self.supply.execute("OUTP1 ON")
        self.assertEqual(self.supply.execute("OUTP1?"), "0")
        # Backing the setpoint below the limit makes the output stick.
        self.supply.execute("PROT1:CLE")
        self.supply.execute("SOUR1:VOLT 0.5")
        self.supply.execute("OUTP1 ON")
        self.assertEqual(self.supply.execute("OUTP1?"), "1")

    def test_unknown_header_queues_an_error(self):
        self.assertIsNone(self.supply.execute("NOPE:THING 1"))
        self.assertIn("Undefined header", self.supply.execute("SYST:ERR?"))
        self.assertIn("No error", self.supply.execute("SYST:ERR?"))

    def test_out_of_range_setpoint_is_rejected(self):
        self.supply.execute("SOUR1:VOLT 999")
        self.assertIn("-222", self.supply.execute("SYST:ERR?"))
        self.assertEqual(float(self.supply.execute("SOUR1:VOLT?")), 0.0)

    def test_selected_channel_applies_to_bare_headers(self):
        self.supply.execute("INST:NSEL 2")
        self.supply.execute("VOLT 7")
        self.assertEqual(float(self.supply.execute("SOUR2:VOLT?")), 7.0)
        self.assertEqual(float(self.supply.execute("SOUR1:VOLT?")), 0.0)

    def test_reset_restores_defaults(self):
        self.supply.execute("SOUR1:VOLT 5")
        self.supply.execute("OUTP1 ON")
        self.supply.execute("*RST")
        self.assertEqual(float(self.supply.execute("SOUR1:VOLT?")), 0.0)
        self.assertEqual(self.supply.execute("OUTP1?"), "0")

    def test_bad_channel_number_is_an_error_not_a_crash(self):
        self.assertIsNone(self.supply.execute("SOUR9:VOLT 1"))
        self.assertIn("-224", self.supply.execute("SYST:ERR?"))


if __name__ == "__main__":
    unittest.main()
