"""Time source indirection.

Every timing-sensitive component (monitor loops, sequence waits) takes a clock
so tests can run instantly and deterministically instead of really sleeping.
"""

import time


class Clock:
    """Real time: monotonic timestamps and blocking sleeps."""

    def monotonic(self):
        return time.monotonic()

    def wall(self):
        return time.time()

    def sleep(self, seconds):
        if seconds > 0:
            time.sleep(seconds)


class FakeClock(Clock):
    """Virtual time. ``sleep`` advances the clock instead of blocking."""

    def __init__(self, start=0.0, wall_start=1_700_000_000.0):
        self.now = float(start)
        self.wall_now = float(wall_start)
        self.sleeps = []

    def monotonic(self):
        return self.now

    def wall(self):
        return self.wall_now

    def sleep(self, seconds):
        if seconds > 0:
            self.sleeps.append(seconds)
            self.now += seconds
            self.wall_now += seconds


SYSTEM_CLOCK = Clock()
