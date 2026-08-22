"""USB/RS-232 transport. Requires the optional ``pyserial`` dependency."""

from ..errors import TransportError
from .base import Transport


class SerialTransport(Transport):
    """Line-oriented SCPI over a serial port."""

    def __init__(self, port, baudrate=115200, timeout=2.0, **kwargs):
        super().__init__(timeout=timeout)
        self.port = port
        self.baudrate = baudrate
        self.name = "serial://{}".format(port)
        self._kwargs = kwargs
        self._serial = None

    def _open_impl(self):
        try:
            import serial  # noqa: WPS433 (optional dependency, imported lazily)
        except ImportError:
            raise TransportError(
                "serial support needs pyserial: pip install 'powerdev[serial]'")
        try:
            self._serial = serial.Serial(
                port=self.port, baudrate=self.baudrate, timeout=self.timeout,
                **self._kwargs)
        except Exception as exc:  # pyserial raises SerialException
            raise TransportError("cannot open {}: {}".format(self.name, exc))

    def _close_impl(self):
        if self._serial is not None:
            try:
                self._serial.close()
            finally:
                self._serial = None

    def write_raw(self, data):
        try:
            self._serial.write(data)
            self._serial.flush()
        except Exception as exc:
            raise TransportError("write to {} failed: {}".format(self.name, exc))

    def read_raw_line(self):
        try:
            line = self._serial.readline()
        except Exception as exc:
            raise TransportError("read from {} failed: {}".format(self.name, exc))
        if not line:
            raise TransportError(
                "timed out after {}s waiting for a response from {}".format(
                    self.timeout, self.name))
        return line.rstrip(b"\r\n")
