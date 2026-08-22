"""A thin SCPI client: string commands in, parsed values out."""

import re

from .errors import DeviceError

_ERROR_RE = re.compile(r'^\s*(?P<code>-?\d+)\s*,\s*"?(?P<message>[^"]*)"?')
_TRUE_WORDS = {"1", "ON", "TRUE"}


class ScpiClient:
    """Wraps a transport with SCPI conventions.

    ``check_errors`` drains ``SYST:ERR?`` after every command that does not
    return data. It costs one extra round trip but turns a silently ignored
    command into a loud exception -- worth it when the command was "set the
    output to 12 V".
    """

    def __init__(self, transport, check_errors=True, trace=None):
        self.transport = transport
        self.check_errors = check_errors
        #: Optional ``callable(direction, text)`` hook, used by ``--verbose``.
        self.trace = trace

    def _trace(self, direction, text):
        if self.trace is not None:
            self.trace(direction, text)

    # -- primitives ------------------------------------------------------
    def write(self, command, check=None):
        self._trace(">", command)
        self.transport.write(command)
        if self.check_errors if check is None else check:
            self.raise_on_error(command)

    def query(self, command):
        self._trace(">", command)
        response = self.transport.query(command)
        self._trace("<", response)
        return response

    def query_float(self, command):
        response = self.query(command)
        try:
            return float(response.split(",")[0])
        except ValueError:
            raise DeviceError(
                "expected a number from '{}', got {!r}".format(command, response))

    def query_floats(self, command):
        response = self.query(command)
        try:
            return [float(part) for part in response.split(",")]
        except ValueError:
            raise DeviceError(
                "expected numbers from '{}', got {!r}".format(command, response))

    def query_bool(self, command):
        return self.query(command).strip().upper() in _TRUE_WORDS

    # -- instrument basics -----------------------------------------------
    def idn(self):
        return self.query("*IDN?")

    def reset(self):
        self.write("*RST")

    def clear(self):
        self.write("*CLS", check=False)

    def wait_for_complete(self):
        return self.query("*OPC?")

    # -- error queue ------------------------------------------------------
    def next_error(self):
        """Pop one entry off the instrument error queue as ``(code, text)``."""
        response = self.query("SYST:ERR?")
        match = _ERROR_RE.match(response)
        if not match:
            raise DeviceError("unparsable error response: {!r}".format(response))
        return int(match.group("code")), match.group("message").strip()

    def drain_errors(self, limit=16):
        errors = []
        for _ in range(limit):
            code, message = self.next_error()
            if code == 0:
                break
            errors.append((code, message))
        return errors

    def raise_on_error(self, context=None):
        errors = self.drain_errors()
        if not errors:
            return
        detail = "; ".join("{} ({})".format(msg, code) for code, msg in errors)
        prefix = "instrument rejected '{}': ".format(context) if context else ""
        raise DeviceError(prefix + detail, code=errors[0][0])

    def close(self):
        self.transport.close()
