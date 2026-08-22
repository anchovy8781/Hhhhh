"""Transport interface shared by every link type."""

import abc

from ..errors import TransportError


class Transport(abc.ABC):
    """A line-oriented byte pipe to an instrument.

    Subclasses implement the three raw hooks; the string-level ``write`` /
    ``read`` / ``query`` helpers are shared.
    """

    #: Human readable description used in error messages and ``powerdev id``.
    name = "transport"
    write_termination = "\n"
    read_termination = "\n"
    encoding = "ascii"

    def __init__(self, timeout=2.0):
        self.timeout = timeout
        self._open = False

    # -- lifecycle -------------------------------------------------------
    @property
    def is_open(self):
        return self._open

    def open(self):
        if not self._open:
            self._open_impl()
            self._open = True
        return self

    def close(self):
        if self._open:
            try:
                self._close_impl()
            finally:
                self._open = False

    def __enter__(self):
        return self.open()

    def __exit__(self, *exc_info):
        self.close()
        return False

    # -- raw hooks -------------------------------------------------------
    @abc.abstractmethod
    def _open_impl(self):
        ...

    @abc.abstractmethod
    def _close_impl(self):
        ...

    @abc.abstractmethod
    def write_raw(self, data):
        ...

    @abc.abstractmethod
    def read_raw_line(self):
        """Return one response line *without* its terminator, or raise."""

    # -- string helpers --------------------------------------------------
    def _require_open(self):
        if not self._open:
            raise TransportError("{} is not open".format(self.name))

    def write(self, command):
        self._require_open()
        self.write_raw((command + self.write_termination).encode(self.encoding))

    def read(self):
        self._require_open()
        return self.read_raw_line().decode(self.encoding, "replace").strip()

    def query(self, command):
        self.write(command)
        return self.read()

    def __repr__(self):
        state = "open" if self._open else "closed"
        return "<{} {} {}>".format(type(self).__name__, self.name, state)
