// -----------------------------------------------------------------------------
// Energy from power: Hilo reports the live power of the meter and of each
// device (watts, pushed when it changes) but no energy counter, so each one
// gets an index in kWh that integrates its power over time — what the Home
// Assistant integration does with its "Riemann sum" energy sensors. The power
// holds until the next reading (it is pushed on change), and only while the
// live link is up: a time without link adds nothing.
//
// The indexes are published as `energy-sensor/index`, from which Gladys
// derives the 30-minute consumption and its cost. Kept in /data.
// -----------------------------------------------------------------------------

import { TIMINGS } from './constants.js';

const MS_PER_HOUR = 3_600_000;

export class EnergyMeters {
  /** `saved`: { key: kwh } from /data. */
  constructor(saved = {}, { maxGap = TIMINGS.energyMaxGap } = {}) {
    this.maxGap = maxGap;
    /** key -> { kwh, watts, at } */
    this.meters = new Map();
    for (const [key, kwh] of Object.entries(saved ?? {})) {
      if (Number.isFinite(kwh) && kwh >= 0) {
        this.meters.set(key, { kwh, watts: null, at: null });
      }
    }
  }

  integrate(meter, now, live) {
    if (live && meter.watts !== null && meter.at !== null) {
      const elapsed = now - meter.at;
      if (elapsed > 0 && elapsed <= this.maxGap) {
        meter.kwh += (meter.watts * elapsed) / MS_PER_HOUR / 1000;
      }
    }
    meter.at = now;
  }

  /** A new power reading (W) of one meter. */
  power(key, watts, now, live) {
    const meter = this.meters.get(key) ?? { kwh: 0, watts: null, at: null };
    this.integrate(meter, now, live);
    meter.watts = Number.isFinite(watts) && watts > 0 ? watts : 0;
    this.meters.set(key, meter);
  }

  /** The clock: integrates every meter up to `now`. */
  tick(now, live) {
    for (const meter of this.meters.values()) {
      this.integrate(meter, now, live);
    }
  }

  /** The link dropped: the powers are unknown until the next readings. */
  pause(now) {
    for (const meter of this.meters.values()) {
      this.integrate(meter, now, true);
      meter.watts = null;
    }
  }

  has(key) {
    return this.meters.has(key);
  }

  /** The index of one meter, kWh rounded to the watt-hour. */
  value(key) {
    const meter = this.meters.get(key);
    return meter ? Math.round(meter.kwh * 1000) / 1000 : undefined;
  }

  /** What /data keeps: { key: kwh }. */
  snapshot() {
    return Object.fromEntries([...this.meters].map(([key, meter]) => [key, meter.kwh]));
  }

  forget(key) {
    this.meters.delete(key);
  }
}
