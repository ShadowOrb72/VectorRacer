(function (global) {
  'use strict';

  /**
   * Parse user input data lines:
   *   time, duration, acceleration, angle
   * Supports comments (# or //), optional header row, blank lines.
   */
  function parseProgram(rawText) {
    const lines = String(rawText || '').split(/\r?\n/);
    const commands = [];
    const errors = [];

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const original = lines[i];
      // Strip inline comments
      const cleaned = original.replace(/(#|\/\/).*$/, '').trim();
      if (!cleaned) continue;

      // Skip header line if user pasted "time, duration, acceleration, angle"
      if (/^time\b/i.test(cleaned)) continue;

      // Split on comma (or whitespace if no commas)
      const parts = cleaned.includes(',')
        ? cleaned.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        : cleaned.split(/\s+/);

      if (parts.length !== 4) {
        errors.push({
          line: lineNum,
          message: `Line ${lineNum}: expected 4 values (time, duration, acceleration, angle), found ${parts.length}.`
        });
        continue;
      }

      const time = Number(parts[0]);
      const duration = Number(parts[1]);
      const acceleration = Number(parts[2]);
      const angle = Number(parts[3]);

      if (!Number.isFinite(time) || time < 0) {
        errors.push({ line: lineNum, message: `Line ${lineNum}: time must be a number >= 0.` });
        continue;
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        errors.push({ line: lineNum, message: `Line ${lineNum}: duration must be > 0.` });
        continue;
      }
      if (!Number.isFinite(acceleration)) {
        errors.push({ line: lineNum, message: `Line ${lineNum}: acceleration must be a valid number.` });
        continue;
      }
      if (!Number.isFinite(angle)) {
        errors.push({ line: lineNum, message: `Line ${lineNum}: angle must be a valid number in degrees.` });
        continue;
      }

      const rad = (angle * Math.PI) / 180;
      commands.push({
        index: commands.length,
        line: lineNum,
        time,
        duration,
        endTime: time + duration,
        acceleration,
        angle,
        ax: acceleration * Math.cos(rad),
        ay: acceleration * Math.sin(rad)
      });
    }

    return { commands, errors };
  }

  /**
   * Serialize commands array back into canonical text format.
   */
  function serializeProgram(commands) {
    return commands
      .map((c) => `${trimNum(c.time)}, ${trimNum(c.duration)}, ${trimNum(c.acceleration)}, ${trimNum(c.angle)}`)
      .join('\n');
  }

  function trimNum(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return Number(n.toFixed(4)).toString();
  }

  // ---------------------------------------------------------------------------
  // Geometry Helpers
  // ---------------------------------------------------------------------------
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y;
      const xj = poly[j].x, yj = poly[j].y;
      const intersect =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-15) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distPointToSegmentSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 1e-12) {
      t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ex = px - cx;
    const ey = py - cy;
    return ex * ex + ey * ey;
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const rX = bx - ax;
    const rY = by - ay;
    const sX = dx - cx;
    const sY = dy - cy;
    const denom = rX * sY - rY * sX;
    if (Math.abs(denom) < 1e-12) return null;

    const qpx = cx - ax;
    const qpy = cy - ay;
    const t = (qpx * sY - qpy * sX) / denom;
    const u = (qpx * rY - qpy * rX) / denom;

    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return { t, u, x: ax + t * rX, y: ay + t * rY };
    }
    return null;
  }

  function minDistToPolyEdges(x, y, poly) {
    let minSq = Infinity;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const dSq = distPointToSegmentSq(x, y, a.x, a.y, b.x, b.y);
      if (dSq < minSq) minSq = dSq;
    }
    return Math.sqrt(minSq);
  }

  function segmentHitsPoly(x1, y1, x2, y2, poly) {
    const n = poly.length;
    let earliest = null;
    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const hit = segmentsIntersect(x1, y1, x2, y2, a.x, a.y, b.x, b.y);
      if (hit && (!earliest || hit.t < earliest.t)) {
        earliest = hit;
      }
    }
    return earliest;
  }

  /**
   * Check whether a circle at (x, y) with radius r is cleanly inside the track corridor.
   * Corridor = inside outer polygon, outside inner polygon, and >= r away from both walls.
   */
  function checkTrackCollision(prevX, prevY, x, y, track) {
    const r = track.carRadius;

    // Swept segment check prevents tunneling at huge accelerations
    const hitOuter = segmentHitsPoly(prevX, prevY, x, y, track.outer);
    if (hitOuter) return { collided: true, wall: 'outer', hitPoint: hitOuter };
    const hitInner = segmentHitsPoly(prevX, prevY, x, y, track.inner);
    if (hitInner) return { collided: true, wall: 'inner', hitPoint: hitInner };

    // Inside corridor check
    const inOuter = pointInPolygon(x, y, track.outer);
    const inInner = pointInPolygon(x, y, track.inner);
    if (!inOuter) return { collided: true, wall: 'outer', hitPoint: { x, y, t: 1 } };
    if (inInner) return { collided: true, wall: 'inner', hitPoint: { x, y, t: 1 } };

    // Clearance check against both boundaries
    const dOuter = minDistToPolyEdges(x, y, track.outer);
    if (dOuter < r) return { collided: true, wall: 'outer', hitPoint: { x, y, t: 1 } };
    const dInner = minDistToPolyEdges(x, y, track.inner);
    if (dInner < r) return { collided: true, wall: 'inner', hitPoint: { x, y, t: 1 } };

    return { collided: false, clearance: Math.min(dOuter, dInner) - r };
  }

  /**
   * Compute total acceleration vector at time t (half-open interval [time, endTime)).
   */
  function getAccelerationAt(commands, t) {
    let ax = 0;
    let ay = 0;
    const activeLines = [];
    for (let i = 0; i < commands.length; i++) {
      const c = commands[i];
      if (t >= c.time - 1e-9 && t < c.endTime - 1e-9) {
        ax += c.ax;
        ay += c.ay;
        activeLines.push(c.line);
      }
    }
    return { ax, ay, activeLines };
  }

  /**
   * Deterministic full simulation of a program on a track.
   * Uses exact piecewise-constant acceleration kinematics with event-aligned substeps.
   *
   * Returns:
   *  status: 'finished' | 'crashed' | 'stopped' | 'timeout'
   *  samples: Array of { t, x, y, vx, vy, ax, ay, speed, heading, activeLines, checkpointIdx }
   *  metrics: { finishTime, crashTime, maxSpeed, totalDistance, totalImpulse, minClearance, commandsUsed }
   */
  function simulateRun(track, commands, options) {
    const opts = options || {};
    const maxStep = opts.maxStep || 0.01; // 10ms physics substep
    const sampleInterval = opts.sampleInterval || 0.02; // 50Hz trajectory recording
    const lastCmdEnd = commands.reduce((m, c) => Math.max(m, c.endTime), 0);
    const maxTime = opts.maxTime || Math.min(120, Math.max(lastCmdEnd + 12, 25));

    // Collect exact event boundary timestamps (start/end of every command)
    const eventTimesSet = new Set([0, maxTime]);
    for (let i = 0; i < commands.length; i++) {
      if (commands[i].time <= maxTime) eventTimesSet.add(commands[i].time);
      if (commands[i].endTime <= maxTime) eventTimesSet.add(commands[i].endTime);
    }
    const eventTimes = Array.from(eventTimesSet).sort((a, b) => a - b);

    let t = 0;
    let x = track.startPos.x;
    let y = track.startPos.y;
    let vx = 0;
    let vy = 0;
    let heading = track.startHeading || 0;

    let checkpointIdx = 0;
    let maxSpeed = 0;
    let totalDistance = 0;
    let totalImpulse = 0;
    let minClearance = Infinity;
    let idleAfterCommands = 0;
    let nextSampleT = sampleInterval;

    const initAcc = getAccelerationAt(commands, 0);
    const samples = [
      {
        t: 0,
        x,
        y,
        vx: 0,
        vy: 0,
        ax: initAcc.ax,
        ay: initAcc.ay,
        speed: 0,
        heading,
        activeLines: initAcc.activeLines,
        checkpointIdx: 0
      }
    ];

    let status = 'timeout';
    let crashPoint = null;
    let crashWall = null;
    let finishTime = null;

    outerLoop: for (let e = 0; e < eventTimes.length - 1; e++) {
      const segStart = eventTimes[e];
      const segEnd = eventTimes[e + 1];
      if (segEnd <= segStart + 1e-12) continue;

      // Acceleration is strictly constant over (segStart, segEnd)
      const midT = (segStart + segEnd) * 0.5;
      const { ax, ay, activeLines } = getAccelerationAt(commands, midT);
      const accMag = Math.hypot(ax, ay);

      const segDur = segEnd - segStart;
      const subSteps = Math.max(1, Math.ceil(segDur / maxStep));
      const dt = segDur / subSteps;

      for (let s = 0; s < subSteps; s++) {
        const prevX = x;
        const prevY = y;
        const prevT = t;

        // Exact constant-acceleration integration
        const newX = x + vx * dt + 0.5 * ax * dt * dt;
        const newY = y + vy * dt + 0.5 * ay * dt * dt;
        const newVx = vx + ax * dt;
        const newVy = vy + ay * dt;
        const newT = prevT + dt;

        const stepDist = Math.hypot(newX - prevX, newY - prevY);
        const speed = Math.hypot(newVx, newVy);
        if (speed > 0.05) {
          heading = Math.atan2(newVy, newVx);
        }

        // 1. Check wall collision first
        const col = checkTrackCollision(prevX, prevY, newX, newY, track);
        if (col.collided) {
          const hitT = prevT + (col.hitPoint.t !== undefined ? col.hitPoint.t * dt : dt);
          const hitX = col.hitPoint.x;
          const hitY = col.hitPoint.y;
          totalDistance += Math.hypot(hitX - prevX, hitY - prevY);
          totalImpulse += accMag * (hitT - prevT);
          status = 'crashed';
          crashWall = col.wall;
          crashPoint = { x: hitX, y: hitY, t: hitT };
          samples.push({
            t: hitT,
            x: hitX,
            y: hitY,
            vx: newVx,
            vy: newVy,
            ax,
            ay,
            speed,
            heading,
            activeLines,
            checkpointIdx
          });
          break outerLoop;
        }

        if (col.clearance < minClearance) minClearance = col.clearance;

        // 2. Check ordered checkpoints
        if (checkpointIdx < track.checkpoints.length) {
          const gate = track.checkpoints[checkpointIdx];
          const cross = segmentsIntersect(prevX, prevY, newX, newY, gate.a.x, gate.a.y, gate.b.x, gate.b.y);
          if (cross) {
            const mvx = newX - prevX;
            const mvy = newY - prevY;
            if (mvx * gate.dir.x + mvy * gate.dir.y > 0) {
              checkpointIdx++;
            }
          }
        } else {
          // All checkpoints cleared — check finish line crossing in forward direction!
          const fg = track.finishGate;
          const cross = segmentsIntersect(prevX, prevY, newX, newY, fg.a.x, fg.a.y, fg.b.x, fg.b.y);
          if (cross) {
            const mvx = newX - prevX;
            const mvy = newY - prevY;
            if (mvx * fg.dir.x + mvy * fg.dir.y > 0) {
              finishTime = prevT + cross.t * dt;
              totalDistance += Math.hypot(cross.x - prevX, cross.y - prevY);
              totalImpulse += accMag * (finishTime - prevT);
              if (speed > maxSpeed) maxSpeed = speed;
              status = 'finished';
              samples.push({
                t: finishTime,
                x: cross.x,
                y: cross.y,
                vx: vx + ax * (finishTime - prevT),
                vy: vy + ay * (finishTime - prevT),
                ax,
                ay,
                speed,
                heading,
                activeLines,
                checkpointIdx: track.checkpoints.length + 1
              });
              break outerLoop;
            }
          }
        }

        // Commit step
        x = newX;
        y = newY;
        vx = newVx;
        vy = newVy;
        t = newT;
        totalDistance += stepDist;
        totalImpulse += accMag * dt;
        if (speed > maxSpeed) maxSpeed = speed;

        if (t >= nextSampleT - 1e-9) {
          samples.push({
            t,
            x,
            y,
            vx,
            vy,
            ax,
            ay,
            speed,
            heading,
            activeLines,
            checkpointIdx
          });
          nextSampleT += sampleInterval;
        }

        // If all commands have finished and racer has virtually stopped, end cleanly
        if (t > lastCmdEnd + 0.25 && speed < 0.08 && accMag === 0) {
          idleAfterCommands += dt;
          if (idleAfterCommands > 0.8) {
            status = 'stopped';
            samples.push({
              t,
              x,
              y,
              vx,
              vy,
              ax: 0,
              ay: 0,
              speed,
              heading,
              activeLines: [],
              checkpointIdx
            });
            break outerLoop;
          }
        } else {
          idleAfterCommands = 0;
        }
      }
    }

    const lastSample = samples[samples.length - 1];
    if (status === 'timeout' && lastSample.t < t - 1e-6) {
      samples.push({
        t,
        x,
        y,
        vx,
        vy,
        ax: 0,
        ay: 0,
        speed: Math.hypot(vx, vy),
        heading,
        activeLines: [],
        checkpointIdx
      });
    }

    return {
      status,
      samples,
      crashPoint,
      crashWall,
      finishTime,
      totalTime: samples[samples.length - 1].t,
      checkpointsCleared: Math.min(checkpointIdx, track.checkpoints.length),
      totalCheckpoints: track.checkpoints.length,
      metrics: {
        finishTime,
        endTime: samples[samples.length - 1].t,
        maxSpeed,
        totalDistance,
        totalImpulse,
        minClearance: Number.isFinite(minClearance) ? minClearance : 0,
        commandsUsed: commands.length
      }
    };
  }

  /**
   * Sample interpolated state at any playback timestamp t from recorded samples.
   */
  function sampleAtTime(samples, t) {
    if (!samples || samples.length === 0) return null;
    if (t <= samples[0].t) return { sample: samples[0], index: 0 };
    const lastIdx = samples.length - 1;
    if (t >= samples[lastIdx].t) return { sample: samples[lastIdx], index: lastIdx };

    // Binary search
    let lo = 0;
    let hi = lastIdx;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].t <= t) lo = mid;
      else hi = mid;
    }

    const a = samples[lo];
    const b = samples[hi];
    const span = b.t - a.t;
    const f = span > 1e-9 ? (t - a.t) / span : 0;

    return {
      index: lo,
      sample: {
        t,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        vx: a.vx + (b.vx - a.vx) * f,
        vy: a.vy + (b.vy - a.vy) * f,
        ax: a.ax,
        ay: a.ay,
        speed: a.speed + (b.speed - a.speed) * f,
        heading: lerpAngle(a.heading, b.heading, f),
        activeLines: a.activeLines,
        checkpointIdx: a.checkpointIdx
      }
    };
  }

  function lerpAngle(a, b, f) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * f;
  }

  global.VectorRacer = global.VectorRacer || {};
  global.VectorRacer.parseProgram = parseProgram;
  global.VectorRacer.serializeProgram = serializeProgram;
  global.VectorRacer.simulateRun = simulateRun;
  global.VectorRacer.sampleAtTime = sampleAtTime;
})(typeof window !== 'undefined' ? window : globalThis);
