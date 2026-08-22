import unittest

from powerdev.drivers import Driver, RigolDP800Driver, SimSupplyDriver, detect, registry


class DetectionTests(unittest.TestCase):
    def test_simulator_channel_count_comes_from_the_idn(self):
        driver = detect("PowerDev,SIM-PSU-4CH,SN1,1.0.0")
        self.assertIsInstance(driver, SimSupplyDriver)
        self.assertEqual(driver.channels, 4)

    def test_rigol_is_recognised(self):
        driver = detect("RIGOL TECHNOLOGIES,DP832,DP8A1,00.01.16")
        self.assertIsInstance(driver, RigolDP800Driver)
        self.assertEqual(driver.channels, 3)

    def test_unknown_instrument_falls_back_to_generic_scpi(self):
        driver = detect("Acme Instruments,PSU-9000,42,1.0")
        self.assertIs(type(driver), Driver)
        self.assertEqual(driver.channels, 1)

    def test_generic_driver_is_last_in_the_registry(self):
        self.assertIs(registry()[-1], Driver)


class CommandDialectTests(unittest.TestCase):
    def test_generic_uses_suffixed_output_headers(self):
        driver = Driver()
        self.assertEqual(driver.set_output(2, True), "OUTP2 ON")
        self.assertEqual(driver.get_output(2), "OUTP2?")
        self.assertEqual(driver.set_voltage(1, 3.3), "SOUR1:VOLT 3.3000")

    def test_rigol_passes_the_channel_as_an_argument(self):
        driver = RigolDP800Driver()
        self.assertEqual(driver.set_output(2, False), ":OUTP CH2,OFF")
        self.assertEqual(driver.get_output(1), ":OUTP? CH1")

    def test_simulator_driver_exposes_the_load_helper(self):
        driver = SimSupplyDriver()
        self.assertEqual(driver.set_load(1, 8), "SIM:LOAD1 8.0000")
        self.assertEqual(driver.set_load(1, float("inf")), "SIM:LOAD1 INF")


if __name__ == "__main__":
    unittest.main()
