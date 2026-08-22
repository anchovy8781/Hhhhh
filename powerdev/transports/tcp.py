"""Raw-socket transport for LAN instruments (SCPI/LXI, usually port 5025)."""

import socket

from ..errors import TransportError
from .base import Transport


class TcpTransport(Transport):
    """Line-oriented SCPI over a TCP stream."""

    def __init__(self, host, port=5025, timeout=2.0):
        super().__init__(timeout=timeout)
        self.host = host
        self.port = port
        self.name = "tcp://{}:{}".format(host, port)
        self._socket = None
        self._buffer = b""

    def _open_impl(self):
        try:
            self._socket = socket.create_connection(
                (self.host, self.port), timeout=self.timeout)
        except OSError as exc:
            raise TransportError("cannot connect to {}: {}".format(self.name, exc))
        self._socket.settimeout(self.timeout)
        self._buffer = b""

    def _close_impl(self):
        if self._socket is not None:
            try:
                self._socket.close()
            finally:
                self._socket = None

    def write_raw(self, data):
        try:
            self._socket.sendall(data)
        except OSError as exc:
            raise TransportError("write to {} failed: {}".format(self.name, exc))

    def read_raw_line(self):
        terminator = self.read_termination.encode(self.encoding)
        while terminator not in self._buffer:
            try:
                chunk = self._socket.recv(4096)
            except socket.timeout:
                raise TransportError(
                    "timed out after {}s waiting for a response from {}".format(
                        self.timeout, self.name))
            except OSError as exc:
                raise TransportError("read from {} failed: {}".format(self.name, exc))
            if not chunk:
                raise TransportError("{} closed the connection".format(self.name))
            self._buffer += chunk
        line, _, self._buffer = self._buffer.partition(terminator)
        return line.rstrip(b"\r")
