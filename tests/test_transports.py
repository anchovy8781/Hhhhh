import unittest

from powerdev.errors import PowerDevError, TransportError
from powerdev.transports import SerialTransport, SimTransport, TcpTransport, open_transport


class UrlParsingTests(unittest.TestCase):
    def test_sim_url_with_parameters(self):
        transport = open_transport("sim://psu?channels=4&load=8&vmax=60")
        self.addCleanup(transport.close)
        self.assertIsInstance(transport, SimTransport)
        self.assertEqual(len(transport.supply.channels), 4)
        self.assertEqual(transport.supply.channel(1).load_ohms, 8.0)
        self.assertEqual(transport.supply.channel(1).max_voltage, 60.0)

    def test_sim_preset_starts_energised(self):
        transport = open_transport("sim://psu?v=5&i=1&on=1&load=10")
        self.addCleanup(transport.close)
        self.assertEqual(transport.query("MEAS:ALL? CH1"), "5.0000,0.5000,2.5000")

    def test_tcp_url_defaults_to_port_5025(self):
        transport = open_transport("tcp://10.0.0.5", connect=False)
        self.assertIsInstance(transport, TcpTransport)
        self.assertEqual((transport.host, transport.port), ("10.0.0.5", 5025))

    def test_serial_url_keeps_the_device_path(self):
        transport = open_transport("serial:///dev/ttyUSB0?baud=9600", connect=False)
        self.assertIsInstance(transport, SerialTransport)
        self.assertEqual(transport.port, "/dev/ttyUSB0")
        self.assertEqual(transport.baudrate, 9600)

    def test_bare_host_port_shorthand_is_tcp(self):
        transport = open_transport("192.168.1.9:5555", connect=False)
        self.assertIsInstance(transport, TcpTransport)
        self.assertEqual(transport.port, 5555)

    def test_bare_port_name_shorthand_is_serial(self):
        transport = open_transport("COM4", connect=False)
        self.assertIsInstance(transport, SerialTransport)
        self.assertEqual(transport.port, "COM4")

    def test_unknown_scheme_is_rejected(self):
        with self.assertRaises(PowerDevError):
            open_transport("gpib://7")


class SimTransportTests(unittest.TestCase):
    def test_query_round_trip(self):
        with open_transport("sim://psu") as transport:
            self.assertTrue(transport.query("*IDN?").startswith("PowerDev,"))

    def test_reading_with_no_pending_response_times_out(self):
        with open_transport("sim://psu") as transport:
            with self.assertRaises(TransportError):
                transport.read()

    def test_use_before_open_is_refused(self):
        transport = open_transport("sim://psu", connect=False)
        with self.assertRaises(TransportError):
            transport.write("*IDN?")

    def test_close_is_idempotent(self):
        transport = open_transport("sim://psu")
        transport.close()
        transport.close()
        self.assertFalse(transport.is_open)


if __name__ == "__main__":
    unittest.main()
