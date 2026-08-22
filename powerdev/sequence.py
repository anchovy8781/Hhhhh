"""Run scripted power sequences (bring-up, ramps, limit checks) from a file.

A sequence is JSON (or YAML when PyYAML is installed)::

    {
      "name": "3v3 rail bring-up",
      "steps": [
        {"op": "set",     "channel": 1, "voltage": 3.3, "current": 0.5},
        {"op": "output",  "channel": 1, "state": "on"},
        {"op": "wait",    "seconds": 0.2},
        {"op": "check",   "channel": 1,
         "voltage": {"nominal": 3.3, "tolerance_pct": 2},
         "current": {"max": 0.4}}
      ]
    }

Failures stop the run and, unless told otherwise, every output is switched off
before the runner returns -- a half-finished power sequence should not be left
energised.
"""

import json
import os
from dataclasses import dataclass, field

from .clock import SYSTEM_CLOCK
from .errors import PowerDevError, SequenceError

PASS = "pass"
FAIL = "fail"
ERROR = "error"
SKIP = "skip"

OPS = ("set", "output", "wait", "measure", "check", "ramp", "reset", "load", "log")


@dataclass
class StepResult:
    index: int
    op: str
    name: str = ""
    status: str = PASS
    detail: str = ""
    readings: list = field(default_factory=list)
    duration: float = 0.0

    @property
    def ok(self):
        return self.status in (PASS, SKIP)

    def as_dict(self):
        return {
            "index": self.index,
            "op": self.op,
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "duration_s": round(self.duration, 6),
            "readings": [r.as_dict() for r in self.readings],
        }


@dataclass
class SequenceReport:
    name: str
    steps: list = field(default_factory=list)
    duration: float = 0.0
    shutdown_performed: bool = False

    @property
    def passed(self):
        return all(step.ok for step in self.steps)

    @property
    def failures(self):
        return [step for step in self.steps if not step.ok]

    def as_dict(self):
        return {
            "name": self.name,
            "passed": self.passed,
            "duration_s": round(self.duration, 6),
            "shutdown_performed": self.shutdown_performed,
            "steps": [step.as_dict() for step in self.steps],
        }


def load_sequence(path):
    """Read a sequence file (JSON, or YAML when PyYAML is available)."""
    if not os.path.exists(path):
        raise SequenceError("sequence file not found: {}".format(path))
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if path.lower().endswith((".yaml", ".yml")):
        try:
            import yaml
        except ImportError:
            raise SequenceError(
                "YAML sequences need PyYAML (pip install pyyaml); "
                "JSON sequences work with no extra dependency")
        spec = yaml.safe_load(text)
    else:
        try:
            spec = json.loads(text)
        except ValueError as exc:
            raise SequenceError("{} is not valid JSON: {}".format(path, exc))
    return validate_sequence(spec, source=path)


def validate_sequence(spec, source="<sequence>"):
    """Check the shape of a sequence before touching any hardware."""
    if not isinstance(spec, dict):
        raise SequenceError("{}: top level must be an object".format(source))
    steps = spec.get("steps")
    if not isinstance(steps, list) or not steps:
        raise SequenceError("{}: 'steps' must be a non-empty list".format(source))
    for number, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            raise SequenceError(
                "{}: step {} must be an object".format(source, number))
        op = step.get("op")
        if op not in OPS:
            raise SequenceError(
                "{}: step {} has unknown op {!r} (known ops: {})".format(
                    source, number, op, ", ".join(OPS)))
    return spec


def _limits_ok(value, spec):
    """Compare ``value`` against a limit spec; return ``(ok, description)``."""
    if not isinstance(spec, dict):
        spec = {"nominal": float(spec)}
    low = spec.get("min")
    high = spec.get("max")
    nominal = spec.get("nominal")
    if nominal is not None:
        if "tolerance_pct" in spec:
            margin = abs(float(nominal)) * float(spec["tolerance_pct"]) / 100.0
        else:
            margin = float(spec.get("tolerance", 0.0))
        low = float(nominal) - margin if low is None else low
        high = float(nominal) + margin if high is None else high
    if low is None and high is None:
        raise SequenceError(
            "limit spec needs min, max, nominal or tolerance: {!r}".format(spec))
    ok = True
    if low is not None and value < float(low) - 1e-9:
        ok = False
    if high is not None and value > float(high) + 1e-9:
        ok = False
    bounds = "{}..{}".format(
        "-inf" if low is None else "{:g}".format(float(low)),
        "+inf" if high is None else "{:g}".format(float(high)))
    return ok, bounds


class SequenceRunner:
    """Executes a validated sequence against a :class:`~powerdev.device.PowerSupply`."""

    def __init__(self, supply, clock=None, on_step=None):
        self.supply = supply
        self.clock = clock or supply.clock or SYSTEM_CLOCK
        self.on_step = on_step

    def run(self, spec, stop_on_fail=None, safe_shutdown=None):
        spec = validate_sequence(spec)
        if stop_on_fail is None:
            stop_on_fail = bool(spec.get("stop_on_fail", True))
        if safe_shutdown is None:
            safe_shutdown = bool(spec.get("safe_shutdown", True))

        report = SequenceReport(name=spec.get("name", "sequence"))
        start = self.clock.monotonic()
        for index, step in enumerate(spec["steps"], start=1):
            result = self._run_step(index, step)
            report.steps.append(result)
            if self.on_step is not None:
                self.on_step(result)
            if not result.ok and stop_on_fail:
                break
        report.duration = self.clock.monotonic() - start

        if safe_shutdown:
            self.supply.all_outputs_off()
            report.shutdown_performed = True
        return report

    # -- step dispatch ------------------------------------------------------
    def _run_step(self, index, step):
        op = step["op"]
        result = StepResult(index=index, op=op, name=step.get("name", ""))
        started = self.clock.monotonic()
        try:
            handler = getattr(self, "_op_" + op)
            handler(step, result)
        except SequenceError as exc:
            result.status = ERROR
            result.detail = str(exc)
        except PowerDevError as exc:
            result.status = ERROR
            result.detail = "{}: {}".format(type(exc).__name__, exc)
        result.duration = self.clock.monotonic() - started
        return result

    def _channel(self, step):
        return self.supply.channel(int(step.get("channel", 1)))

    def _op_set(self, step, result):
        channel = self._channel(step)
        channel.configure(
            voltage=step.get("voltage"), current=step.get("current"),
            ovp=step.get("ovp"), ocp=step.get("ocp"))
        applied = ["{}={}".format(key, step[key])
                   for key in ("voltage", "current", "ovp", "ocp") if key in step]
        result.detail = "CH{} {}".format(channel.index, " ".join(applied) or "no-op")

    def _op_output(self, step, result):
        channel = self._channel(step)
        state = step.get("state", True)
        if isinstance(state, str):
            state = state.strip().lower() in ("on", "1", "true", "yes")
        channel.set_output(bool(state))
        result.detail = "CH{} output {}".format(
            channel.index, "on" if state else "off")

    def _op_wait(self, step, result):
        seconds = float(step.get("seconds", 0))
        self.clock.sleep(seconds)
        result.detail = "waited {:g}s".format(seconds)

    def _op_measure(self, step, result):
        channels = step.get("channels") or [step.get("channel", 1)]
        result.readings = [self.supply.channel(int(c)).measure() for c in channels]
        result.detail = "; ".join(str(r) for r in result.readings)

    def _op_check(self, step, result):
        channel = self._channel(step)
        reading = channel.measure()
        result.readings = [reading]
        problems = []
        checked = []
        for key, attribute in (("voltage", "voltage"), ("current", "current"),
                               ("power", "power")):
            if key not in step:
                continue
            value = getattr(reading, attribute)
            ok, bounds = _limits_ok(value, step[key])
            checked.append("{}={:.4f} in {}".format(key, value, bounds))
            if not ok:
                problems.append("{} {:.4f} outside {}".format(key, value, bounds))
        if "mode" in step:
            expected = str(step["mode"]).strip().upper()
            checked.append("mode={}".format(reading.mode))
            if reading.mode != expected:
                problems.append("mode {} != {}".format(reading.mode, expected))
        if not checked:
            raise SequenceError("check step has nothing to check")
        result.detail = "CH{} {}".format(channel.index, ", ".join(checked))
        if problems:
            result.status = FAIL
            result.detail = "CH{} {}".format(channel.index, "; ".join(problems))

    def _op_ramp(self, step, result):
        channel = self._channel(step)
        start = float(step.get("from", 0.0))
        end = float(step["to"]) if "to" in step else None
        if end is None:
            raise SequenceError("ramp step needs a 'to' voltage")
        points = max(int(step.get("steps", 10)), 1)
        seconds = float(step.get("seconds", 1.0))
        dwell = seconds / points
        readings = []
        for number in range(1, points + 1):
            value = start + (end - start) * number / points
            channel.set_voltage(value)
            self.clock.sleep(dwell)
            if step.get("measure", True):
                readings.append(channel.measure())
        result.readings = readings
        result.detail = "CH{} ramp {:g}V -> {:g}V in {:g}s ({} steps)".format(
            channel.index, start, end, seconds, points)

    def _op_reset(self, step, result):
        self.supply.reset()
        result.detail = "instrument reset"

    def _op_load(self, step, result):
        """Simulator-only helper; skipped on real hardware."""
        setter = getattr(self.supply.driver, "set_load", None)
        if setter is None:
            result.status = SKIP
            result.detail = "driver {} has no simulated load".format(
                self.supply.driver.name)
            return
        channel = self._channel(step)
        ohms = float(step.get("ohms", step.get("load", 10)))
        self.supply.client.write(setter(channel.index, ohms))
        result.detail = "CH{} simulated load {:g} ohm".format(channel.index, ohms)

    def _op_log(self, step, result):
        result.detail = str(step.get("message", ""))


def run_sequence(spec, supply, clock=None, on_step=None, **kwargs):
    """Convenience wrapper around :class:`SequenceRunner`."""
    return SequenceRunner(supply, clock=clock, on_step=on_step).run(spec, **kwargs)
