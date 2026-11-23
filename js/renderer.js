(function (global) {
  'use strict';

  const WORLD_W = global.VectorRacer.WORLD_W;
  const WORLD_H = global.VectorRacer.WORLD_H;

  class ClassicRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = window.devicePixelRatio || 1;
      this.pad = { left: 38, right: 20, top: 20, bottom: 32 };
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.shakeTime = 0;
      this.particles = [];
      this.hoverWorld = null;
      this.rulerStart = null;
      this.rulerEnd = null;
    }

    resize() {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';

      const availW = w - this.pad.left - this.pad.right;
      const availH = h - this.pad.top - this.pad.bottom;
      this.scale = Math.min(availW / WORLD_W, availH / WORLD_H);
      this.offsetX = this.pad.left + (availW - WORLD_W * this.scale) * 0.5;
      this.offsetY = this.pad.top + (availH - WORLD_H * this.scale) * 0.5;
    }

    worldToScreen(wx, wy) {
      return {
        x: this.offsetX + wx * this.scale,
        y: this.offsetY + (WORLD_H - wy) * this.scale
      };
    }

    screenToWorld(sx, sy) {
      return {
        x: (sx - this.offsetX) / this.scale,
        y: WORLD_H - (sy - this.offsetY) / this.scale
      };
    }

    triggerCrash(wx, wy) {
      this.shakeTime = 0.32;
      this.particles = [];
      for (let i = 0; i < 28; i++) {
        const ang = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.25;
        const spd = 6 + Math.random() * 18;
        this.particles.push({
          x: wx,
          y: wy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0.45 + Math.random() * 0.4,
          maxLife: 0.85,
          color: i % 3 === 0 ? '#c9382b' : i % 3 === 1 ? '#d98a1c' : '#1d232a',
          size: 1.6 + Math.random() * 2.2
        });
      }
    }

    triggerFinish(wx, wy) {
      this.particles = [];
      const colors = ['#1d232a', '#f7f3e8', '#c9382b', '#1f6b47', '#c98a1c'];
      for (let i = 0; i < 36; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 5 + Math.random() * 16;
        this.particles.push({
          x: wx,
          y: wy,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0.7 + Math.random() * 0.6,
          maxLife: 1.3,
          color: colors[i % colors.length],
          size: 2.2 + Math.random() * 2.4
        });
      }
    }

    updateEffects(dt) {
      if (this.shakeTime > 0) {
        this.shakeTime = Math.max(0, this.shakeTime - dt);
      }
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.life -= dt;
        if (p.life <= 0) this.particles.splice(i, 1);
      }
    }

    render(state) {
      const ctx = this.ctx;
      const w = this.canvas.width / this.dpr;
      const h = this.canvas.height / this.dpr;

      ctx.save();
      ctx.scale(this.dpr, this.dpr);

      // Subtle screen shake on crash
      if (this.shakeTime > 0) {
        const mag = (this.shakeTime / 0.32) * 5;
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
      }

      // 1. Classic Graph Paper Background
      this.drawGraphPaper(ctx, w, h);

      // 2. Classic Racetrack Circuit
      const track = state.track;
      this.drawTrack(ctx, track, state.currentSample);

      // 3. Previous Run Ghost Trail
      if (state.showGhost && state.ghostRun && state.ghostRun.samples.length > 1) {
        this.drawTrail(ctx, state.ghostRun.samples, state.ghostRun.samples.length - 1, {
          stroke: 'rgba(35, 92, 134, 0.42)',
          lineWidth: 2,
          dash: [5, 5],
          showTicks: false,
          endMarker: state.ghostRun.status === 'crashed' ? 'crash' : null
        });
      }

      // 4. Current Run Trail
      if (state.activeRun && state.activeRun.samples.length > 1) {
        this.drawTrail(ctx, state.activeRun.samples, state.currentSampleIdx, {
          stroke: '#d6971c',
          lineWidth: 2.6,
          dash: null,
          showTicks: state.showTimeTicks
        });
      }

      // 5. Vectors & Racer
      const sample = state.currentSample || {
        t: 0,
        x: track.startPos.x,
        y: track.startPos.y,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        speed: 0,
        heading: track.startHeading || 0,
        checkpointIdx: 0
      };

      if (state.showVectors) {
        this.drawVectors(ctx, sample);
      }

      const isCrashedNow =
        state.activeRun &&
        state.activeRun.status === 'crashed' &&
        state.currentSampleIdx >= state.activeRun.samples.length - 1;

      this.drawClassicCar(ctx, sample, track.carRadius, isCrashedNow);

      // 6. Crash / Finish Callout Badge on Canvas
      if (isCrashedNow && state.activeRun.crashPoint) {
        this.drawBadge(
          ctx,
          state.activeRun.crashPoint.x,
          state.activeRun.crashPoint.y,
          `CRASH @ ${state.activeRun.crashPoint.t.toFixed(2)}s`,
          '#c9382b',
          '#fff8f0'
        );
      } else if (
        state.activeRun &&
        state.activeRun.status === 'finished' &&
        state.currentSampleIdx >= state.activeRun.samples.length - 1
      ) {
        this.drawBadge(
          ctx,
          sample.x,
          sample.y,
          `FINISH! ${state.activeRun.finishTime.toFixed(2)}s`,
          '#1f6b47',
          '#f7f3e8'
        );
      }

      // 7. Particles
      this.drawParticles(ctx);

      // 8. Interactive Drafting Ruler (drag to measure distance & angle)
      if (this.rulerStart && this.rulerEnd) {
        this.drawRuler(ctx, this.rulerStart, this.rulerEnd);
      } else if (this.hoverWorld) {
        this.drawHoverCrosshair(ctx, this.hoverWorld);
      }

      // 9. Classic Compass Rose (0, 90, 180, -90)
      this.drawCompassRose(ctx, w - 58, 56);

      ctx.restore();
    }

    drawGraphPaper(ctx, w, h) {
      ctx.fillStyle = '#f4efe2';
      ctx.fillRect(0, 0, w, h);

      const tl = this.worldToScreen(0, WORLD_H);
      const br = this.worldToScreen(WORLD_W, 0);

      // Minor 2m grid
      ctx.strokeStyle = 'rgba(54, 102, 128, 0.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 2) {
        const sx = this.worldToScreen(x, 0).x;
        ctx.moveTo(sx, tl.y);
        ctx.lineTo(sx, br.y);
      }
      for (let y = 0; y <= WORLD_H; y += 2) {
        const sy = this.worldToScreen(0, y).y;
        ctx.moveTo(tl.x, sy);
        ctx.lineTo(br.x, sy);
      }
      ctx.stroke();

      // Major 10m grid
      ctx.strokeStyle = 'rgba(42, 86, 110, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= WORLD_W; x += 10) {
        const sx = this.worldToScreen(x, 0).x;
        ctx.moveTo(sx, tl.y);
        ctx.lineTo(sx, br.y);
      }
      for (let y = 0; y <= WORLD_H; y += 10) {
        const sy = this.worldToScreen(0, y).y;
        ctx.moveTo(tl.x, sy);
        ctx.lineTo(br.x, sy);
      }
      ctx.stroke();

      // World frame border
      ctx.strokeStyle = '#314957';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

      // Axis coordinates
      ctx.fillStyle = '#475a66';
      ctx.font = '600 10px "Courier New", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let x = 0; x <= WORLD_W; x += 20) {
        const sx = this.worldToScreen(x, 0).x;
        ctx.fillText(`${x}m`, sx, br.y + 6);
      }

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let y = 0; y <= WORLD_H; y += 20) {
        const sy = this.worldToScreen(0, y).y;
        ctx.fillText(`${y}`, tl.x - 6, sy);
      }
    }

    tracePoly(ctx, poly) {
      if (!poly || poly.length === 0) return;
      const p0 = this.worldToScreen(poly[0].x, poly[0].y);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < poly.length; i++) {
        const p = this.worldToScreen(poly[i].x, poly[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }

    drawKerbs(ctx, poly) {
      const n = poly.length;
      const kerbWidth = Math.max(3, this.scale * 0.55);
      ctx.lineCap = 'butt';
      ctx.lineWidth = kerbWidth;
      for (let i = 0; i < n; i++) {
        const a = this.worldToScreen(poly[i].x, poly[i].y);
        const b = this.worldToScreen(poly[(i + 1) % n].x, poly[(i + 1) % n].y);
        ctx.strokeStyle = i % 2 === 0 ? '#c9382b' : '#f7f3e8';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    drawTrack(ctx, track, currentSample) {
      // Subtle classic drop shadow beneath asphalt
      ctx.save();
      ctx.beginPath();
      this.tracePoly(ctx, track.outer);
      this.tracePoly(ctx, track.inner);
      ctx.fillStyle = '#30363d';
      ctx.fill('evenodd');

      // Subtle inner asphalt texture ring
      ctx.beginPath();
      this.tracePoly(ctx, track.center);
      ctx.strokeStyle = 'rgba(244, 239, 226, 0.22)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([7, 7]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Classic red-and-white kerbs along outer & inner walls
      this.drawKerbs(ctx, track.outer);
      this.drawKerbs(ctx, track.inner);

      // Bold ink wall lines (the collision boundaries)
      ctx.strokeStyle = '#14181c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.tracePoly(ctx, track.outer);
      ctx.stroke();

      ctx.beginPath();
      this.tracePoly(ctx, track.inner);
      ctx.stroke();

      // Checkpoints (S1, S2, S3)
      const clearedCount = currentSample ? currentSample.checkpointIdx : 0;
      track.checkpoints.forEach((cp, idx) => {
        const a = this.worldToScreen(cp.a.x, cp.a.y);
        const b = this.worldToScreen(cp.b.x, cp.b.y);
        const cleared = clearedCount > idx;

        ctx.strokeStyle = cleared ? '#3cb371' : 'rgba(217, 154, 38, 0.72)';
        ctx.lineWidth = cleared ? 2.4 : 1.6;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Sector pill label
        const mid = this.worldToScreen(cp.mid.x, cp.mid.y);
        ctx.fillStyle = cleared ? '#1f6b47' : '#23292f';
        ctx.strokeStyle = cleared ? '#9de3bc' : '#d99a26';
        ctx.lineWidth = 1.2;
        const label = cleared ? `${cp.label} ✓` : cp.label;
        ctx.font = 'bold 10px "Courier New", Consolas, monospace';
        const tw = ctx.measureText(label).width + 10;
        ctx.beginPath();
        ctx.roundRect(mid.x - tw / 2, mid.y - 9, tw, 18, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f7f3e8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mid.x, mid.y + 0.5);
      });

      // Checkered Start / Finish Line
      this.drawCheckeredGate(ctx, track.finishGate);

      // Direction arrow painted on asphalt just ahead of start
      const sp = track.startPos;
      const dir = track.finishGate.dir;
      const arrA = this.worldToScreen(sp.x + dir.x * 3.2, sp.y + dir.y * 3.2);
      const arrB = this.worldToScreen(sp.x + dir.x * 9.5, sp.y + dir.y * 9.5);
      this.drawArrow(ctx, arrA.x, arrA.y, arrB.x, arrB.y, 'rgba(247, 243, 232, 0.55)', 2, 7);

      ctx.restore();
    }

    drawCheckeredGate(ctx, gate) {
      const a = this.worldToScreen(gate.a.x, gate.a.y);
      const b = this.worldToScreen(gate.b.x, gate.b.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const cols = Math.max(6, Math.round(len / 6));
      const cell = len / cols;
      const rows = 2;

      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(angle);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#f7f3e8' : '#14181c';
          ctx.fillRect(c * cell, (r - 1) * cell, cell + 0.4, cell + 0.4);
        }
      }
      ctx.strokeStyle = '#14181c';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, -cell, len, cell * 2);
      ctx.restore();

      // Label below start/finish
      const mid = this.worldToScreen(gate.mid.x, Math.min(gate.a.y, gate.b.y) - 2.6);
      ctx.fillStyle = '#1d232a';
      ctx.font = 'bold 10px "Courier New", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('START / FINISH', mid.x, mid.y);
    }

    drawTrail(ctx, samples, maxIdx, opts) {
      const end = Math.min(maxIdx, samples.length - 1);
      if (end < 1) return;

      ctx.save();
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = opts.lineWidth || 2;
      if (opts.dash) ctx.setLineDash(opts.dash);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.beginPath();
      const s0 = this.worldToScreen(samples[0].x, samples[0].y);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i <= end; i++) {
        const pt = this.worldToScreen(samples[i].x, samples[i].y);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw crisp 1-second time markers along the active trail
      if (opts.showTicks) {
        let nextSec = 1;
        ctx.font = 'bold 9px "Courier New", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let i = 1; i <= end; i++) {
          if (samples[i].t >= nextSec) {
            const pt = this.worldToScreen(samples[i].x, samples[i].y);
            ctx.fillStyle = '#f7f3e8';
            ctx.strokeStyle = '#1d232a';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#f7f3e8';
            ctx.fillText(`${nextSec}s`, pt.x, pt.y - 5);
            nextSec++;
          }
        }
      }

      if (opts.endMarker === 'crash') {
        const last = this.worldToScreen(samples[end].x, samples[end].y);
        ctx.strokeStyle = 'rgba(201, 56, 43, 0.65)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(last.x - 5, last.y - 5);
        ctx.lineTo(last.x + 5, last.y + 5);
        ctx.moveTo(last.x + 5, last.y - 5);
        ctx.lineTo(last.x - 5, last.y + 5);
        ctx.stroke();
      }

      ctx.restore();
    }

    drawVectors(ctx, sample) {
      const origin = this.worldToScreen(sample.x, sample.y);

      // Velocity Vector (classic blueprint cyan/blue)
      const vMag = Math.hypot(sample.vx, sample.vy);
      if (vMag > 0.2) {
        const vScale = 0.42; // world meters per m/s
        const vTip = this.worldToScreen(sample.x + sample.vx * vScale, sample.y + sample.vy * vScale);
        this.drawArrow(ctx, origin.x, origin.y, vTip.x, vTip.y, '#4da3e8', 2.4, 8);
      }

      // Acceleration Vector (classic racing red)
      const aMag = Math.hypot(sample.ax, sample.ay);
      if (aMag > 0.1) {
        const aScale = 0.45;
        const aTip = this.worldToScreen(sample.x + sample.ax * aScale, sample.y + sample.ay * aScale);
        this.drawArrow(ctx, origin.x, origin.y, aTip.x, aTip.y, '#ef473a', 2.6, 8);
      }
    }

    drawArrow(ctx, x1, y1, x2, y2, color, width, headLen) {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - headLen * Math.cos(ang - 0.45), y2 - headLen * Math.sin(ang - 0.45));
      ctx.lineTo(x2 - headLen * Math.cos(ang + 0.45), y2 - headLen * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    drawClassicCar(ctx, sample, radiusWorld, crashed) {
      const pos = this.worldToScreen(sample.x, sample.y);
      const rPx = Math.max(7, radiusWorld * this.scale);
      // Canvas Y is flipped relative to world Y, so negate heading angle
      const canvasHeading = -sample.heading;

      ctx.save();
      ctx.translate(pos.x, pos.y);

      // Thrust flame opposite acceleration direction
      const aMag = Math.hypot(sample.ax, sample.ay);
      if (aMag > 0.1 && !crashed) {
        const thrustCanvasAngle = Math.atan2(sample.ay, -sample.ax); // opposite to (ax, -ay)
        ctx.save();
        ctx.rotate(thrustCanvasAngle);
        const flameLen = rPx * (1.2 + Math.min(1.6, aMag / 16) + Math.random() * 0.3);
        ctx.fillStyle = '#f29f24';
        ctx.beginPath();
        ctx.moveTo(rPx * 0.7, -rPx * 0.36);
        ctx.lineTo(rPx * 0.7 + flameLen, 0);
        ctx.lineTo(rPx * 0.7, rPx * 0.36);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#fff3b0';
        ctx.beginPath();
        ctx.moveTo(rPx * 0.7, -rPx * 0.18);
        ctx.lineTo(rPx * 0.7 + flameLen * 0.55, 0);
        ctx.lineTo(rPx * 0.7, rPx * 0.18);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      ctx.rotate(canvasHeading);

      // Subtle collision radius ring
      ctx.strokeStyle = crashed ? 'rgba(201, 56, 43, 0.9)' : 'rgba(247, 243, 232, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, rPx, 0, Math.PI * 2);
      ctx.stroke();

      // Classic open-wheel Grand Prix car silhouette
      // Four tires
      ctx.fillStyle = '#121518';
      const wx = rPx * 0.52;
      const wy = rPx * 0.64;
      const tw = rPx * 0.5;
      const th = rPx * 0.28;
      ctx.fillRect(wx - tw / 2, -wy - th / 2, tw, th);
      ctx.fillRect(wx - tw / 2, wy - th / 2, tw, th);
      ctx.fillRect(-wx - tw / 2, -wy - th / 2, tw, th);
      ctx.fillRect(-wx - tw / 2, wy - th / 2, tw, th);

      // Chassis body (classic racing red, darkened if crashed)
      ctx.fillStyle = crashed ? '#7a251d' : '#d63b2c';
      ctx.strokeStyle = '#14181c';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(rPx * 1.15, 0);
      ctx.quadraticCurveTo(rPx * 0.65, -rPx * 0.52, -rPx * 0.85, -rPx * 0.44);
      ctx.lineTo(-rPx * 1.0, -rPx * 0.28);
      ctx.lineTo(-rPx * 1.0, rPx * 0.28);
      ctx.lineTo(-rPx * 0.85, rPx * 0.44);
      ctx.quadraticCurveTo(rPx * 0.65, rPx * 0.52, rPx * 1.15, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Classic cream racing stripe
      ctx.fillStyle = '#f7f3e8';
      ctx.fillRect(-rPx * 0.8, -rPx * 0.1, rPx * 1.65, rPx * 0.2);

      // Driver helmet
      ctx.fillStyle = '#f7f3e8';
      ctx.strokeStyle = '#14181c';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(-rPx * 0.12, 0, rPx * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    drawBadge(ctx, wx, wy, text, bg, fg) {
      const p = this.worldToScreen(wx, wy);
      ctx.save();
      ctx.font = 'bold 11px "Courier New", Consolas, monospace';
      const tw = ctx.measureText(text).width + 16;
      const bx = Math.max(12, Math.min(this.canvas.width / this.dpr - tw - 12, p.x - tw / 2));
      const by = Math.max(12, p.y - 34);

      ctx.fillStyle = '#14181c';
      ctx.fillRect(bx + 2, by + 2, tw, 22);
      ctx.fillStyle = bg;
      ctx.fillRect(bx, by, tw, 22);
      ctx.strokeStyle = '#14181c';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, tw, 22);

      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + tw / 2, by + 11);
      ctx.restore();
    }

    drawParticles(ctx) {
      ctx.save();
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        const pt = this.worldToScreen(p.x, p.y);
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.fillRect(pt.x - p.size / 2, pt.y - p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }

    drawHoverCrosshair(ctx, hw) {
      if (hw.x < 0 || hw.x > WORLD_W || hw.y < 0 || hw.y > WORLD_H) return;
      const pt = this.worldToScreen(hw.x, hw.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(29, 35, 42, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pt.x - 10, pt.y);
      ctx.lineTo(pt.x + 10, pt.y);
      ctx.moveTo(pt.x, pt.y - 10);
      ctx.lineTo(pt.x, pt.y + 10);
      ctx.stroke();
      ctx.restore();
    }

    drawRuler(ctx, a, b) {
      const sa = this.worldToScreen(a.x, a.y);
      const sb = this.worldToScreen(b.x, b.y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.4) return;

      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

      ctx.save();
      ctx.strokeStyle = '#1f6b47';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
      ctx.setLineDash([]);

      this.drawArrow(ctx, sa.x, sa.y, sb.x, sb.y, '#1f6b47', 2, 8);

      ctx.fillStyle = '#1f6b47';
      ctx.beginPath();
      ctx.arc(sa.x, sa.y, 4, 0, Math.PI * 2);
      ctx.fill();

      const label = `d=${dist.toFixed(1)}m | θ=${angleDeg.toFixed(1)}°`;
      const mx = (sa.x + sb.x) * 0.5;
      const my = (sa.y + sb.y) * 0.5 - 14;
      ctx.font = 'bold 11px "Courier New", Consolas, monospace';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = '#f7f3e8';
      ctx.strokeStyle = '#1f6b47';
      ctx.lineWidth = 1.5;
      ctx.fillRect(mx - tw / 2, my - 10, tw, 20);
      ctx.strokeRect(mx - tw / 2, my - 10, tw, 20);
      ctx.fillStyle = '#1d232a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, mx, my);
      ctx.restore();
    }

    drawCompassRose(ctx, cx, cy) {
      const r = 24;
      ctx.save();
      ctx.translate(cx, cy);

      // Vintage circular dial
      ctx.fillStyle = 'rgba(247, 243, 232, 0.92)';
      ctx.strokeStyle = '#1d232a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Crosshairs
      ctx.strokeStyle = '#6c7c88';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-r + 4, 0);
      ctx.lineTo(r - 4, 0);
      ctx.moveTo(0, -r + 4);
      ctx.lineTo(0, r - 4);
      ctx.stroke();

      // Highlight 0° right arrow
      ctx.fillStyle = '#c9382b';
      ctx.beginPath();
      ctx.moveTo(r - 3, 0);
      ctx.lineTo(r - 10, -4);
      ctx.lineTo(r - 10, 4);
      ctx.closePath();
      ctx.fill();

      // Degree labels matching Konsep.txt
      ctx.font = 'bold 9px "Courier New", Consolas, monospace';
      ctx.fillStyle = '#1d232a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('90°', 0, -r - 8);
      ctx.fillText('-90°', 0, r + 9);
      ctx.textAlign = 'left';
      ctx.fillText('0°', r + 4, 0);
      ctx.textAlign = 'right';
      ctx.fillText('180°', -r - 4, 0);

      ctx.restore();
    }
  }

  global.VectorRacer = global.VectorRacer || {};
  global.VectorRacer.ClassicRenderer = ClassicRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
