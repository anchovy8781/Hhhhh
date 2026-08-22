"""Exception hierarchy for powerdev."""


class PowerDevError(Exception):
    """Base class for every error raised by powerdev."""


class TransportError(PowerDevError):
    """The link to the instrument failed (open, timeout, closed socket...)."""


class DeviceError(PowerDevError):
    """The instrument accepted the link but rejected or mishandled a command."""

    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


class ProtectionTripped(DeviceError):
    """An over-voltage / over-current protection latched on the instrument."""

    def __init__(self, message, channel=None, kind=None):
        super().__init__(message)
        self.channel = channel
        self.kind = kind


class SequenceError(PowerDevError):
    """A test sequence file is malformed or a step could not be executed."""
