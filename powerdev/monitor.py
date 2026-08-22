"""Sampling loop: log voltage/current/power over time and summarise it."""

import csv
import json
from dataclasses import dataclass, field

from .clock import SYSTEM_CLOCK
from .errors import PowerDevError


@dataclass
class Sample:
    """One sweep across the monitored channels."""

    index: int
    elapsed: float
    timestamp: float
    readings: list = field(default_factory=list)

    def by_channel(self, channel):
        for reading in self.readings:
            if reading.channel == channel:
                return reading
        raise KeyError(channel)

    def as_dict(self):
        return {
            "sample": self.index,
            "elapsed_s": round(self.elapsed, 6),
            "timestamp": self.timestamp,
            "channels": {str(r.channel): r.as_dict() for r in self.readings},
        }


class Monitor:
    """Sample a supply on a fixed cadence.

    The schedule is anchored to the start time rather than accumulated from
    each sleep, so slow instrument round trips do not make the log drift.
    """

    def __init__(self, supply, channels=None, interval=1.0, duration=None,
                 count=None, clock=None):
        if interval <= 0:
            raise PowerDevError("interval must be greater than zero")
        self.supply = supply
        self.channels = supply._resolve(channels)
        for index in self.channels:
            supply.channel(index)  # fail fast on a bad channel number
        self.interval = float(interval)
        self.duration = None if duration is None else float(duration)
        self.count = None if count is None else int(count)
        self.clock = clock or supply.clock or SYSTEM_CLOCK

    def _finished(self, index, elapsed):
        if self.count is not None and index >= self.count:
            return True
        if self.duration is not None and elapsed > self.duration + 1e-9:
            return True
        return False

    def samples(self):
        """Yield :class:`Sample` objects until the stop condition is met."""
        start = self.clock.monotonic()
        index = 0
        while True:
            target = start + index * self.interval
            now = self.clock.monotonic()
            if now < target:
                self.clock.sleep(target - now)
                now = self.clock.monotonic()
            elapsed = now - start
            if self._finished(index, elapsed):
                return
            readings = [self.supply.channel(c).measure() for c in self.channels]
            yield Sample(index=index, elapsed=elapsed,
                         timestamp=self.clock.wall(), readings=readings)
            index += 1

    def run(self, callback=None):
        collected = []
        for sample in self.samples():
            if callback is not None:
                callback(sample)
            collected.append(sample)
        return collected


def summarize(samples, channels=None):
    """Aggregate samples per channel: min/max/mean and integrated energy."""
    if not samples:
        return {}
    channels = channels or [r.channel for r in samples[0].readings]
    summary = {}
    for channel in channels:
        points = []
        for sample in samples:
            try:
                points.append((sample.elapsed, sample.by_channel(channel)))
            except KeyError:
                continue
        if not points:
            continue
        voltages = [r.voltage for _, r in points]
        currents = [r.current for _, r in points]
        powers = [r.power for _, r in points]
        summary[channel] = {
            "samples": len(points),
            "duration_s": points[-1][0] - points[0][0],
            "voltage": _stats(voltages),
            "current": _stats(currents),
            "power": _stats(powers),
            "energy_wh": _integrate(points) / 3600.0,
        }
    return summary


def _stats(values):
    return {
        "min": min(values),
        "max": max(values),
        "mean": sum(values) / len(values),
        "last": values[-1],
    }


def _integrate(points):
    """Trapezoidal integral of power over elapsed time, in watt-seconds."""
    total = 0.0
    for (t0, r0), (t1, r1) in zip(points, points[1:]):
        total += (r0.power + r1.power) / 2.0 * (t1 - t0)
    return total


class CsvWriter:
    """One row per sample, three columns per channel."""

    def __init__(self, stream, channels):
        self.channels = list(channels)
        self._writer = csv.writer(stream)
        self._stream = stream
        header = ["sample", "elapsed_s", "timestamp"]
        for channel in self.channels:
            header += ["ch{}_v".format(channel), "ch{}_i".format(channel),
                       "ch{}_p".format(channel)]
        self._writer.writerow(header)

    def write(self, sample):
        row = [sample.index, "{:.6f}".format(sample.elapsed),
               "{:.3f}".format(sample.timestamp)]
        for channel in self.channels:
            reading = sample.by_channel(channel)
            row += ["{:.6f}".format(reading.voltage),
                    "{:.6f}".format(reading.current),
                    "{:.6f}".format(reading.power)]
        self._writer.writerow(row)

    def flush(self):
        self._stream.flush()


class JsonlWriter:
    """One JSON object per line -- friendlier for irregular channel sets."""

    def __init__(self, stream, channels=None):
        self._stream = stream

    def write(self, sample):
        self._stream.write(json.dumps(sample.as_dict()) + "\n")

    def flush(self):
        self._stream.flush()


WRITERS = {"csv": CsvWriter, "jsonl": JsonlWriter}


def make_writer(fmt, stream, channels):
    try:
        return WRITERS[fmt](stream, channels)
    except KeyError:
        raise PowerDevError(
            "unknown log format '{}' (choose from {})".format(
                fmt, ", ".join(sorted(WRITERS))))
