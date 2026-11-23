(function (global) {
  'use strict';

  const WORLD_W = 120;
  const WORLD_H = 80;

  /**
   * Build a closed polygon with circular arc fillets at each corner.
   * Each vertex is { x, y, r } where r is the corner fillet radius.
   */
  function buildFilletedPolygon(vertices, arcSteps) {
    const steps = arcSteps || 14;
    const pts = [];
    const n = vertices.length;

    for (let i = 0; i < n; i++) {
      const prev = vertices[(i - 1 + n) % n];
      const curr = vertices[i];
      const next = vertices[(i + 1) % n];

      const v1x = prev.x - curr.x;
      const v1y = prev.y - curr.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;

      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      const u1x = v1x / len1;
      const u1y = v1y / len1;
      const u2x = v2x / len2;
      const u2y = v2y / len2;

      const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
      const angle = Math.acos(dot);
      const r = curr.r || 0;

      if (r <= 0.01 || Math.abs(Math.PI - angle) < 0.01) {
        pts.push({ x: curr.x, y: curr.y });
        continue;
      }

      const halfAngle = angle / 2;
      const maxTrim = Math.min(len1, len2) * 0.48;
      const trim = Math.min(r / Math.tan(halfAngle), maxTrim);
      const actualR = trim * Math.tan(halfAngle);

      const p1x = curr.x + u1x * trim;
      const p1y = curr.y + u1y * trim;
      const p2x = curr.x + u2x * trim;
      const p2y = curr.y + u2y * trim;

      // Bisector direction toward arc center
      const bx = u1x + u2x;
      const by = u1y + u2y;
      const bLen = Math.hypot(bx, by);
      const distCenter = actualR / Math.sin(halfAngle);
      const cx = curr.x + (bx / bLen) * distCenter;
      const cy = curr.y + (by / bLen) * distCenter;

      let a1 = Math.atan2(p1y - cy, p1x - cx);
      let a2 = Math.atan2(p2y - cy, p2x - cx);

      // Determine shortest angular direction from a1 to a2
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      for (let s = 0; s <= steps; s++) {
        const a = a1 + (diff * s) / steps;
        pts.push({
          x: cx + Math.cos(a) * actualR,
          y: cy + Math.sin(a) * actualR
        });
      }
    }
    return pts;
  }

  /**
   * Resample a closed polyline uniformly and offset left/right by halfWidth.
   * Assumes CCW winding so left normal points inward and right normal points outward.
   */
  function buildTrackFromCenterline(centerPts, halfWidth) {
    const n = centerPts.length;
    const outer = [];
    const inner = [];

    for (let i = 0; i < n; i++) {
      const prev = centerPts[(i - 1 + n) % n];
      const curr = centerPts[i];
      const next = centerPts[(i + 1) % n];

      const dx1 = curr.x - prev.x;
      const dy1 = curr.y - prev.y;
      const l1 = Math.hypot(dx1, dy1) || 1;
      const tx1 = dx1 / l1;
      const ty1 = dy1 / l1;

      const dx2 = next.x - curr.x;
      const dy2 = next.y - curr.y;
      const l2 = Math.hypot(dx2, dy2) || 1;
      const tx2 = dx2 / l2;
      const ty2 = dy2 / l2;

      // Average tangent for smooth miter
      let tx = tx1 + tx2;
      let ty = ty1 + ty2;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;

      // For CCW loop, outward normal is (ty, -tx), inward normal is (-ty, tx)
      const nxOut = ty;
      const nyOut = -tx;

      // Miter scale clamp to avoid spikes on tight corners
      const n1x = ty1;
      const n1y = -tx1;
      const cosHalf = Math.max(0.55, nxOut * n1x + nyOut * n1y);
      const offset = halfWidth / cosHalf;

      outer.push({ x: curr.x + nxOut * offset, y: curr.y + nyOut * offset });
      inner.push({ x: curr.x - nxOut * offset, y: curr.y - nyOut * offset });
    }

    return { outer, inner, center: centerPts };
  }

  /**
   * Closed Catmull-Rom spline sampled smoothly.
   */
  function buildClosedSpline(controlPts, samplesPerSeg) {
    const pts = [];
    const n = controlPts.length;
    const steps = samplesPerSeg || 18;

    for (let i = 0; i < n; i++) {
      const p0 = controlPts[(i - 1 + n) % n];
      const p1 = controlPts[i];
      const p2 = controlPts[(i + 1) % n];
      const p3 = controlPts[(i + 2) % n];

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const t2 = t * t;
        const t3 = t2 * t;

        const x =
          0.5 *
          (2 * p1.x +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const y =
          0.5 *
          (2 * p1.y +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

        pts.push({ x, y });
      }
    }
    return pts;
  }

  // Helper to create a gate segment from inner to outer at a given index of a centerline-built track
  function gateAtIndex(geom, idx, label) {
    const n = geom.outer.length;
    const i = ((idx % n) + n) % n;
    const iNext = (i + 1) % n;
    const tx = geom.center[iNext].x - geom.center[i].x;
    const ty = geom.center[iNext].y - geom.center[i].y;
    const tl = Math.hypot(tx, ty) || 1;
    return {
      label: label,
      a: { x: geom.inner[i].x, y: geom.inner[i].y },
      b: { x: geom.outer[i].x, y: geom.outer[i].y },
      dir: { x: tx / tl, y: ty / tl },
      mid: { x: geom.center[i].x, y: geom.center[i].y }
    };
  }

  // Find closest centerline index to target (x, y)
  function closestIdx(center, x, y) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < center.length; i++) {
      const d = Math.hypot(center[i].x - x, center[i].y - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Circuit 1: Classic Oval Speedway
  // ---------------------------------------------------------------------------
  function createClassicOval() {
    const center = buildFilletedPolygon(
      [
        { x: 20, y: 17, r: 17 },
        { x: 100, y: 17, r: 17 },
        { x: 100, y: 63, r: 17 },
        { x: 20, y: 63, r: 17 }
      ],
      18
    );
    const geom = buildTrackFromCenterline(center, 8.2);
    const startIdx = closestIdx(geom.center, 46, 17);
    const s1Idx = closestIdx(geom.center, 100, 40);
    const s2Idx = closestIdx(geom.center, 60, 63);
    const s3Idx = closestIdx(geom.center, 20, 40);

    return {
      id: 'classic-oval',
      name: 'Classic Oval',
      subtitle: 'Wide vintage speedway — ideal for learning inertia & vector turns',
      difficulty: 'Beginner',
      width: WORLD_W,
      height: WORLD_H,
      carRadius: 1.25,
      outer: geom.outer,
      inner: geom.inner,
      center: geom.center,
      startPos: { x: 46, y: 17 },
      startHeading: 0,
      finishGate: {
        label: 'FINISH',
        a: { x: 46, y: 8.8 },
        b: { x: 46, y: 25.2 },
        dir: { x: 1, y: 0 },
        mid: { x: 46, y: 17 }
      },
      checkpoints: [
        gateAtIndex(geom, s1Idx, 'S1'),
        gateAtIndex(geom, s2Idx, 'S2'),
        gateAtIndex(geom, s3Idx, 'S3')
      ],
      startIdx,
      demoProgram: [
        '# Circuit 1: Classic Oval (time, duration, acceleration, angle)',
        '# Right=0, Top=90, Left=180, Bottom=-90',
        '0.0, 2.0, 13.5, 0',
        '2.0, 2.0, 13.5, 180',
        '2.4, 2.0, 11.5, 90',
        '4.4, 2.0, 11.5, -90',
        '4.8, 2.0, 20.0, 180',
        '6.8, 2.0, 20.0, 0',
        '7.2, 2.0, 11.5, -90',
        '9.2, 2.0, 11.5, 90',
        '9.6, 1.8, 16.0, 0'
      ].join('\n')
    };
  }

  // ---------------------------------------------------------------------------
  // Circuit 2: Grand Prix Box (90-degree Technical Circuit)
  // ---------------------------------------------------------------------------
  function createGrandPrixBox() {
    const center = buildFilletedPolygon(
      [
        { x: 19, y: 16, r: 9 },
        { x: 101, y: 16, r: 9 },
        { x: 101, y: 64, r: 9 },
        { x: 19, y: 64, r: 9 }
      ],
      12
    );
    const geom = buildTrackFromCenterline(center, 7.2);
    const s1Idx = closestIdx(geom.center, 101, 40);
    const s2Idx = closestIdx(geom.center, 60, 64);
    const s3Idx = closestIdx(geom.center, 19, 40);

    return {
      id: 'grand-prix-box',
      name: 'Grand Prix Square',
      subtitle: 'Crisp 90° corners requiring timely counter-braking vectors',
      difficulty: 'Standard',
      width: WORLD_W,
      height: WORLD_H,
      carRadius: 1.25,
      outer: geom.outer,
      inner: geom.inner,
      center: geom.center,
      startPos: { x: 42, y: 16 },
      startHeading: 0,
      finishGate: {
        label: 'FINISH',
        a: { x: 42, y: 8.8 },
        b: { x: 42, y: 23.2 },
        dir: { x: 1, y: 0 },
        mid: { x: 42, y: 16 }
      },
      checkpoints: [
        gateAtIndex(geom, s1Idx, 'S1'),
        gateAtIndex(geom, s2Idx, 'S2'),
        gateAtIndex(geom, s3Idx, 'S3')
      ],
      demoProgram: [
        '# Circuit 2: Grand Prix Square',
        '0.0, 1.8, 18.2, 0',
        '1.8, 1.8, 18.2, 180',
        '3.6, 1.6, 18.75, 90',
        '5.2, 1.6, 18.75, -90',
        '6.8, 2.0, 20.5, 180',
        '8.8, 2.0, 20.5, 0',
        '10.8, 1.6, 18.75, -90',
        '12.4, 1.6, 18.75, 90',
        '14.0, 1.6, 16, 0'
      ].join('\n')
    };
  }

  // ---------------------------------------------------------------------------
  // Circuit 3: Monza L-Hairpin
  // ---------------------------------------------------------------------------
  function createMonzaHairpin() {
    const center = buildFilletedPolygon(
      [
        { x: 18, y: 16, r: 9 },
        { x: 102, y: 16, r: 9 },
        { x: 102, y: 40, r: 9 },
        { x: 64, y: 40, r: 9 },
        { x: 64, y: 65, r: 9 },
        { x: 18, y: 65, r: 9 }
      ],
      14
    );
    const geom = buildTrackFromCenterline(center, 6.8);
    const s1Idx = closestIdx(geom.center, 102, 28);
    const s2Idx = closestIdx(geom.center, 64, 53);
    const s3Idx = closestIdx(geom.center, 18, 42);

    return {
      id: 'monza-hairpin',
      name: 'Monaco L-Circuit',
      subtitle: 'Asymmetric 6-corner street loop with an inward chicane',
      difficulty: 'Technical',
      width: WORLD_W,
      height: WORLD_H,
      carRadius: 1.2,
      outer: geom.outer,
      inner: geom.inner,
      center: geom.center,
      startPos: { x: 42, y: 16 },
      startHeading: 0,
      finishGate: {
        label: 'FINISH',
        a: { x: 42, y: 9.2 },
        b: { x: 42, y: 22.8 },
        dir: { x: 1, y: 0 },
        mid: { x: 42, y: 16 }
      },
      checkpoints: [
        gateAtIndex(geom, s1Idx, 'S1'),
        gateAtIndex(geom, s2Idx, 'S2'),
        gateAtIndex(geom, s3Idx, 'S3')
      ],
      demoProgram: [
        '# Circuit 3: Monaco L-Circuit',
        '0.0, 1.8, 18.5, 0',
        '1.8, 1.8, 18.5, 180',
        '3.6, 1.2, 16.67, 90',
        '4.8, 1.2, 16.67, -90',
        '6.0, 1.4, 19.39, 180',
        '7.4, 1.4, 19.39, 0',
        '8.8, 1.2, 17.36, 90',
        '10.0, 1.2, 17.36, -90',
        '11.2, 1.6, 17.97, 180',
        '12.8, 1.6, 17.97, 0',
        '14.4, 1.7, 16.96, -90',
        '16.1, 1.7, 16.96, 90',
        '17.8, 1.6, 18, 0'
      ].join('\n')
    };
  }

  // ---------------------------------------------------------------------------
  // Circuit 4: Silverstone Sweep (Smooth Curved Circuit)
  // ---------------------------------------------------------------------------
  function createSilverstoneSweep() {
    const control = [
      { x: 34, y: 15 },
      { x: 76, y: 15 },
      { x: 102, y: 26 },
      { x: 101, y: 54 },
      { x: 80, y: 66 },
      { x: 58, y: 58 },
      { x: 35, y: 66 },
      { x: 17, y: 50 },
      { x: 18, y: 24 }
    ];
    const center = buildClosedSpline(control, 20);
    const geom = buildTrackFromCenterline(center, 6.8);

    const startIdx = closestIdx(geom.center, 48, 15);
    const s1Idx = closestIdx(geom.center, 101, 40);
    const s2Idx = closestIdx(geom.center, 58, 58);
    const s3Idx = closestIdx(geom.center, 17, 40);

    const fGate = gateAtIndex(geom, startIdx, 'FINISH');

    return {
      id: 'silverstone-sweep',
      name: 'Silverstone Sweep',
      subtitle: 'Flowing classic S-curves — diagonal angles shine here',
      difficulty: 'Pro',
      width: WORLD_W,
      height: WORLD_H,
      carRadius: 1.2,
      outer: geom.outer,
      inner: geom.inner,
      center: geom.center,
      startPos: { x: fGate.mid.x, y: fGate.mid.y },
      startHeading: Math.atan2(fGate.dir.y, fGate.dir.x),
      finishGate: fGate,
      checkpoints: [
        gateAtIndex(geom, s1Idx, 'S1'),
        gateAtIndex(geom, s2Idx, 'S2'),
        gateAtIndex(geom, s3Idx, 'S3')
      ],
      demoProgram: [
        '# Circuit 4: Silverstone Sweep (diagonal vector demo)',
        '0.0, 1.8, 14.4, 4.0',
        '1.8, 1.6, 10.4, 165.1',
        '3.4, 0.8, 20.8, 115.6',
        '4.2, 1.2, 9.9, -138.7',
        '5.4, 0.9, 13.9, -154.7',
        '6.3, 1.0, 12.0, -76.8',
        '7.3, 0.9, 4.9, -104.3',
        '8.2, 0.9, 22.2, 90.8',
        '9.1, 0.9, 19.0, -89.9',
        '10.0, 1.0, 12.1, -54.7',
        '11.0, 1.0, 10.3, -5.1',
        '12.0, 1.0, 6.1, 4.1',
        '13.0, 0.7, 21.0, 51.6',
        '13.7, 1.9, 2.6, 89.3'
      ].join('\n')
    };
  }

  const TRACKS = [
    createClassicOval(),
    createGrandPrixBox(),
    createMonzaHairpin(),
    createSilverstoneSweep()
  ];

  global.VectorRacer = global.VectorRacer || {};
  global.VectorRacer.WORLD_W = WORLD_W;
  global.VectorRacer.WORLD_H = WORLD_H;
  global.VectorRacer.TRACKS = TRACKS;
})(typeof window !== 'undefined' ? window : globalThis);
