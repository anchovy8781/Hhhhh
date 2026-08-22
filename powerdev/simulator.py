"""A simulated SCPI bench power supply.

The simulator is a real state machine, not a stub: it parses a useful subset of
SCPI, models constant-voltage / constant-current crossover against a resistive
load, latches OVP/OCP protection and keeps an instrument error queue. It backs
the ``sim://`` transport so the CLI, drivers, monitor and sequence runner can be
exercised end to end with no hardware attached.
"""

import math
import re

DEFAULT_MAX_VOLTAGE = 32.0
DEFAULT_MAX_CURRENT = 3.2
DEFAULT_LOAD_OHMS = 10.0

#: Long SCPI keywords accepted on input, mapped to their canonical short form.
_LONG_TO_SHORT = {
    "SOURCE": "SOUR",
    "VOLTAGE": "VOLT",
    "CURRENT": "CURR",
    "POWER": "POWE",
    "MEASURE": "MEAS",
    "OUTPUT": "OUTP",
    "INSTRUMENT": "INST",
    "NSELECT": "NSEL",
    "SYSTEM": "SYST",
    "ERROR": "ERR",
    "PROTECTION": "PROT",
    "STATE": "STAT",
    "TRIPPED": "TRIP",
    "CLEAR": "CLE",
    "APPLY": "APPL",
    "VERSION": "VERS",
    "CHANNEL": "CHAN",
}

_TOKEN_RE = re.compile(r"^([A-Z]+)(\d*)$")
_ON_WORDS = {"ON", "1", "TRUE"}
_OFF_WORDS = {"OFF", "0", "FALSE"}

# Instrument error codes, SCPI-1999 style.
ERR_UNDEFINED_HEADER = (-113, "Undefined header")
ERR_ILLEGAL_PARAM = (-224, "Illegal parameter value")
ERR_OUT_OF_RANGE = (-222, "Data out of range")
ERR_MISSING_PARAM = (-109, "Missing parameter")


def _parse_bool(word):
    word = word.strip().upper()
    if word in _ON_WORDS:
        return True
    if word in _OFF_WORDS:
        return False
    raise ValueError(word)


class SimChannel:
    """One output of the simulated supply."""

    def __init__(self, index, max_voltage=DEFAULT_MAX_VOLTAGE,
                 max_current=DEFAULT_MAX_CURRENT, load_ohms=DEFAULT_LOAD_OHMS):
        self.index = index
        self.max_voltage = max_voltage
        self.max_current = max_current
        self.load_ohms = load_ohms
        self.reset()

    def reset(self):
        self.voltage_set = 0.0
        self.current_set = self.max_current
        self.output = False
        self.ovp_level = self.max_voltage
        self.ocp_level = self.max_current
        self.ovp_enabled = False
        self.ocp_enabled = False
        self.ovp_tripped = False
        self.ocp_tripped = False

    @property
    def tripped(self):
        return self.ovp_tripped or self.ocp_tripped

    def clear_protection(self):
        self.ovp_tripped = False
        self.ocp_tripped = False

    def solve(self):
        """Return ``(voltage, current, mode)`` for the present state.

        The load is modelled as a resistor. When Ohm's law would draw more than
        the current setting the supply falls back to constant-current mode and
        the output voltage collapses to ``I_limit * R``.
        """
        if not self.output or self.tripped:
            return 0.0, 0.0, "OFF"
        if math.isinf(self.load_ohms) or self.load_ohms <= 0:
            return self.voltage_set, 0.0, "CV"
        current = self.voltage_set / self.load_ohms
        if current > self.current_set:
            current = self.current_set
            return current * self.load_ohms, current, "CC"
        return self.voltage_set, current, "CV"

    def step(self):
        """Solve the channel and latch any protection that should trip."""
        voltage, current, mode = self.solve()
        if self.ovp_enabled and voltage >= self.ovp_level:
            self.ovp_tripped = True
            self.output = False
            return 0.0, 0.0, "OFF"
        if self.ocp_enabled and current >= self.ocp_level:
            self.ocp_tripped = True
            self.output = False
            return 0.0, 0.0, "OFF"
        return voltage, current, mode


class SimulatedSupply:
    """SCPI command interpreter wrapping a set of :class:`SimChannel`."""

    def __init__(self, channels=3, serial="SN0000001", firmware="1.0.0",
                 max_voltage=DEFAULT_MAX_VOLTAGE, max_current=DEFAULT_MAX_CURRENT,
                 load_ohms=DEFAULT_LOAD_OHMS):
        if channels < 1:
            raise ValueError("a supply needs at least one channel")
        self.channels = [
            SimChannel(i + 1, max_voltage, max_current, load_ohms)
            for i in range(channels)
        ]
        self.serial = serial
        self.firmware = firmware
        self.selected = 1
        self.errors = []
        self.history = []

    # -- identity -------------------------------------------------------
    @property
    def model(self):
        return "SIM-PSU-{}CH".format(len(self.channels))

    def idn(self):
        return "PowerDev,{},{},{}".format(self.model, self.serial, self.firmware)

    def reset(self):
        for channel in self.channels:
            channel.reset()
        self.selected = 1

    # -- helpers --------------------------------------------------------
    def channel(self, index):
        if not 1 <= index <= len(self.channels):
            raise IndexError(index)
        return self.channels[index - 1]

    def _push_error(self, error):
        code, message = error
        self.errors.append('{},"{}"'.format(code, message))

    def _pop_error(self):
        if self.errors:
            return self.errors.pop(0)
        return '0,"No error"'

    @staticmethod
    def _normalize(command):
        """Split a command into ``(header, is_query, argument-string)``."""
        text = command.strip().lstrip(":")
        head, _, args = text.partition(" ")
        is_query = head.endswith("?")
        if is_query:
            head = head[:-1]
        tokens = []
        for token in head.upper().split(":"):
            match = _TOKEN_RE.match(token)
            if match:
                word, suffix = match.groups()
                tokens.append(_LONG_TO_SHORT.get(word, word) + suffix)
            else:
                tokens.append(token)
        return ":".join(tokens), is_query, args.strip()

    @staticmethod
    def _split_suffix(token):
        """``"SOUR2"`` -> ``("SOUR", 2)``; ``"SOUR"`` -> ``("SOUR", None)``."""
        match = _TOKEN_RE.match(token)
        if not match:
            return token, None
        word, suffix = match.groups()
        return word, int(suffix) if suffix else None

    def _channel_from(self, tokens, args):
        """Resolve the target channel from a suffix, a ``CH<n>`` argument or
        the instrument's selected channel."""
        for token in tokens:
            _, suffix = self._split_suffix(token)
            if suffix is not None:
                return self.channel(suffix)
        for part in args.replace(",", " ").split():
            match = re.fullmatch(r"CH(\d+)", part.upper())
            if match:
                return self.channel(int(match.group(1)))
        return self.channel(self.selected)

    # -- command entry point --------------------------------------------
    def execute(self, command):
        """Run one command; return the response string, or ``None`` if silent."""
        command = command.strip()
        self.history.append(command)
        if not command:
            return None
        try:
            return self._dispatch(command)
        except IndexError:
            self._push_error(ERR_ILLEGAL_PARAM)
            return None
        except ValueError:
            self._push_error(ERR_ILLEGAL_PARAM)
            return None

    def _dispatch(self, command):
        if command.startswith("*"):
            return self._common_command(command)

        head, is_query, args = self._normalize(command)
        tokens = head.split(":")
        words = [self._split_suffix(token)[0] for token in tokens]
        key = ":".join(words)

        handler = _HANDLERS.get(key)
        if handler is None:
            self._push_error(ERR_UNDEFINED_HEADER)
            return None
        return handler(self, tokens, is_query, args)

    def _common_command(self, command):
        head, _, _args = command.partition(" ")
        head = head.upper()
        if head == "*IDN?":
            return self.idn()
        if head == "*RST":
            self.reset()
            return None
        if head == "*CLS":
            self.errors.clear()
            return None
        if head == "*OPC?":
            return "1"
        self._push_error(ERR_UNDEFINED_HEADER)
        return None

    # -- individual handlers --------------------------------------------
    def _h_syst_err(self, tokens, is_query, args):
        if not is_query:
            self._push_error(ERR_UNDEFINED_HEADER)
            return None
        return self._pop_error()

    def _h_syst_vers(self, tokens, is_query, args):
        return "1999.0" if is_query else None

    def _h_syst_chan(self, tokens, is_query, args):
        return str(len(self.channels)) if is_query else None

    def _h_inst_nsel(self, tokens, is_query, args):
        if is_query:
            return str(self.selected)
        if not args:
            self._push_error(ERR_MISSING_PARAM)
            return None
        index = int(float(args))
        self.channel(index)  # bounds check
        self.selected = index
        return None

    def _h_inst(self, tokens, is_query, args):
        if is_query:
            return "CH{}".format(self.selected)
        self.selected = self._channel_from([], args).index
        return None

    def _level(self, tokens, is_query, args, attr, limit_attr):
        channel = self._channel_from(tokens, args)
        if is_query:
            return "{:.4f}".format(getattr(channel, attr))
        if not args:
            self._push_error(ERR_MISSING_PARAM)
            return None
        value = float(args.split(",")[0])
        limit = getattr(channel, limit_attr)
        if value < 0 or value > limit:
            self._push_error(ERR_OUT_OF_RANGE)
            return None
        setattr(channel, attr, value)
        return None

    def _h_volt(self, tokens, is_query, args):
        return self._level(tokens, is_query, args, "voltage_set", "max_voltage")

    def _h_curr(self, tokens, is_query, args):
        return self._level(tokens, is_query, args, "current_set", "max_current")

    def _h_volt_prot(self, tokens, is_query, args):
        return self._level(tokens, is_query, args, "ovp_level", "max_voltage")

    def _h_curr_prot(self, tokens, is_query, args):
        return self._level(tokens, is_query, args, "ocp_level", "max_current")

    def _protection_state(self, tokens, is_query, args, attr):
        channel = self._channel_from(tokens, args)
        if is_query:
            return "1" if getattr(channel, attr) else "0"
        setattr(channel, attr, _parse_bool(args))
        return None

    def _h_volt_prot_stat(self, tokens, is_query, args):
        return self._protection_state(tokens, is_query, args, "ovp_enabled")

    def _h_curr_prot_stat(self, tokens, is_query, args):
        return self._protection_state(tokens, is_query, args, "ocp_enabled")

    def _h_volt_prot_trip(self, tokens, is_query, args):
        channel = self._channel_from(tokens, args)
        channel.step()
        return "1" if channel.ovp_tripped else "0"

    def _h_curr_prot_trip(self, tokens, is_query, args):
        channel = self._channel_from(tokens, args)
        channel.step()
        return "1" if channel.ocp_tripped else "0"

    def _h_prot_clear(self, tokens, is_query, args):
        self._channel_from(tokens, args).clear_protection()
        return None

    def _h_outp(self, tokens, is_query, args):
        channel = self._channel_from(tokens, args)
        if is_query:
            channel.step()
            return "1" if channel.output else "0"
        words = [w for w in args.replace(",", " ").split()
                 if not re.fullmatch(r"CH\d+", w.upper())]
        if not words:
            self._push_error(ERR_MISSING_PARAM)
            return None
        state = _parse_bool(words[0])
        if state and channel.tripped:
            self._push_error(ERR_ILLEGAL_PARAM)
            return None
        channel.output = state
        return None

    def _measure(self, tokens, args, what):
        channel = self._channel_from(tokens, args)
        voltage, current, _mode = channel.step()
        if what == "VOLT":
            return "{:.4f}".format(voltage)
        if what == "CURR":
            return "{:.4f}".format(current)
        return "{:.4f}".format(voltage * current)

    def _h_meas_volt(self, tokens, is_query, args):
        return self._measure(tokens, args, "VOLT") if is_query else None

    def _h_meas_curr(self, tokens, is_query, args):
        return self._measure(tokens, args, "CURR") if is_query else None

    def _h_meas_powe(self, tokens, is_query, args):
        return self._measure(tokens, args, "POWE") if is_query else None

    def _h_meas_all(self, tokens, is_query, args):
        if not is_query:
            return None
        channel = self._channel_from(tokens, args)
        voltage, current, _mode = channel.step()
        return "{:.4f},{:.4f},{:.4f}".format(voltage, current, voltage * current)

    def _h_appl(self, tokens, is_query, args):
        """``APPL CH1,5.0,1.0`` sets voltage and current in one shot."""
        parts = [p.strip() for p in args.split(",") if p.strip()]
        channel = self._channel_from(tokens, args)
        values = [p for p in parts if not re.fullmatch(r"CH\d+", p.upper())]
        if is_query:
            return "{:.4f},{:.4f}".format(channel.voltage_set, channel.current_set)
        if not values:
            self._push_error(ERR_MISSING_PARAM)
            return None
        voltage = float(values[0])
        if voltage < 0 or voltage > channel.max_voltage:
            self._push_error(ERR_OUT_OF_RANGE)
            return None
        channel.voltage_set = voltage
        if len(values) > 1:
            current = float(values[1])
            if current < 0 or current > channel.max_current:
                self._push_error(ERR_OUT_OF_RANGE)
                return None
            channel.current_set = current
        return None

    # -- simulator-only extensions ---------------------------------------
    def _h_sim_load(self, tokens, is_query, args):
        """``SIM:LOAD<n> <ohms>`` reshapes the simulated load ("INF" = open)."""
        channel = self._channel_from(tokens, args)
        if is_query:
            return "{:.4f}".format(channel.load_ohms)
        word = args.strip().upper()
        channel.load_ohms = math.inf if word in ("INF", "OPEN") else float(word)
        return None

    def _h_sim_mode(self, tokens, is_query, args):
        channel = self._channel_from(tokens, args)
        return channel.step()[2] if is_query else None


_HANDLERS = {
    "SYST:ERR": SimulatedSupply._h_syst_err,
    "SYST:VERS": SimulatedSupply._h_syst_vers,
    "SYST:CHAN": SimulatedSupply._h_syst_chan,
    "INST:NSEL": SimulatedSupply._h_inst_nsel,
    "INST": SimulatedSupply._h_inst,
    "VOLT": SimulatedSupply._h_volt,
    "SOUR:VOLT": SimulatedSupply._h_volt,
    "CURR": SimulatedSupply._h_curr,
    "SOUR:CURR": SimulatedSupply._h_curr,
    "VOLT:PROT": SimulatedSupply._h_volt_prot,
    "SOUR:VOLT:PROT": SimulatedSupply._h_volt_prot,
    "CURR:PROT": SimulatedSupply._h_curr_prot,
    "SOUR:CURR:PROT": SimulatedSupply._h_curr_prot,
    "VOLT:PROT:STAT": SimulatedSupply._h_volt_prot_stat,
    "SOUR:VOLT:PROT:STAT": SimulatedSupply._h_volt_prot_stat,
    "CURR:PROT:STAT": SimulatedSupply._h_curr_prot_stat,
    "SOUR:CURR:PROT:STAT": SimulatedSupply._h_curr_prot_stat,
    "VOLT:PROT:TRIP": SimulatedSupply._h_volt_prot_trip,
    "SOUR:VOLT:PROT:TRIP": SimulatedSupply._h_volt_prot_trip,
    "CURR:PROT:TRIP": SimulatedSupply._h_curr_prot_trip,
    "SOUR:CURR:PROT:TRIP": SimulatedSupply._h_curr_prot_trip,
    "PROT:CLE": SimulatedSupply._h_prot_clear,
    "OUTP": SimulatedSupply._h_outp,
    "OUTP:STAT": SimulatedSupply._h_outp,
    "MEAS:VOLT": SimulatedSupply._h_meas_volt,
    "MEAS:CURR": SimulatedSupply._h_meas_curr,
    "MEAS:POWE": SimulatedSupply._h_meas_powe,
    "MEAS:ALL": SimulatedSupply._h_meas_all,
    "APPL": SimulatedSupply._h_appl,
    "SIM:LOAD": SimulatedSupply._h_sim_load,
    "SIM:MODE": SimulatedSupply._h_sim_mode,
}
