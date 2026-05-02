import * as THREE from "three";
import { springStep } from "./physics.js";

export class Crowd {
  constructor(scene) {
    this.state = "IDLE";
    this.spectators = [];
    this.time = 0;
    this.wildTimer = 0;
    this.knockoutTimer = 0;
    this.dummy = new THREE.Object3D();
    this.basePositions = [];
    this.baseScales = [];
    this.phases = [];
    this.frequencies = [];
    if (scene) this.scene = scene; // fallback
  }

  init(scene) {
    this.scene = scene;

    const count = 400;
    const headGeo = new THREE.SphereGeometry(0.15, 8, 8);
    headGeo.translate(0, 0.65, 0);
    const torsoGeo = new THREE.CylinderGeometry(0.1, 0.2, 0.6, 8);
    torsoGeo.translate(0, 0.3, 0);

    // Simple substitute for merge
    const geo = new THREE.CylinderGeometry(0.15, 0.25, 0.8, 8);
    geo.translate(0, 0.4, 0);

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // Set white so vertex colors multiply correctly
      roughness: 0.9,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.scene.add(this.mesh);

    const sides = [
      { dir: [0, 1], start: [-5, 5] },
      { dir: [0, -1], start: [-5, -5] },
      { dir: [1, 0], start: [5, -5] },
      { dir: [-1, 0], start: [-5, 5] },
    ];

    const tempColor = new THREE.Color();
    const bgDark = new THREE.Color(0x050505);
    const litColor = new THREE.Color(0x000111); // Darker base lit color

    for (let i = 0; i < count; i++) {
      const side = Math.floor(i / 100);
      const row = Math.floor((i % 100) / 10); // 10 rows
      const col = (i % 100) % 20; // columns spread

      let x = 0,
        z = 0;
      const distance = 5.5 + row * 0.4;
      const spread = (col - 10) * 0.6;

      if (side === 0) {
        x = spread;
        z = -distance;
      } // North
      if (side === 1) {
        x = spread;
        z = distance;
      } // South
      if (side === 2) {
        x = distance;
        z = spread;
      } // East
      if (side === 3) {
        x = -distance;
        z = spread;
      } // West

      const y = row * 0.3 + (Math.random() * 0.1 - 0.05);
      const scale = 1.0 + (Math.random() * 0.2 - 0.1);

      this.basePositions.push(new THREE.Vector3(x, y, z));
      this.baseScales.push(scale);
      this.phases.push(Math.random() * Math.PI * 2);
      this.frequencies.push(0.3 + Math.random() * 0.5);

      this.spectators.push({
        yVel: 0,
        yOffset: 0,
        scaleVel: 0,
        scaleOffset: 0,
        rotX: 0,
        rotY:
          side === 0
            ? 0
            : side === 1
              ? Math.PI
              : side === 2
                ? -Math.PI / 2
                : Math.PI / 2,
        reactDelay: 0,
      });

      this.dummy.position.set(x, y, z);
      this.dummy.scale.set(scale, scale, scale);
      this.dummy.rotation.set(0, this.spectators[i].rotY, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);

      // Fade out to black/background based on row distance
      const fadeRatio = row / 8.0; // row goes 0 to 9
      tempColor.copy(litColor).lerp(bgDark, fadeRatio);
      this.mesh.setColorAt(i, tempColor);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  setState(state) {
    this.state = state;
    if (state === "WILD") {
      this.wildTimer = 2.0;
    } else if (state === "KNOCKOUT_REACTION") {
      this.knockoutTimer = 10;
      // console.log("Knockout reaction triggered");
      for (let i = 0; i < this.spectators.length; i++) {
        const dist = this.basePositions[i].length() - 4.5;
        const delay = dist * 0.08;
        setTimeout(() => {
          this.spectators[i].yOffset = 0.8;
          this.spectators[i].scaleOffset = 0.5;
          this.spectators[i].rotX = -20 * (Math.PI / 180);
        }, delay * 1000);
      }
    }
  }

  react(intensity) {
    if (this.state === "KNOCKOUT_REACTION") return;

    for (let i = 0; i < this.spectators.length; i++) {
      this.spectators[i].yOffset = 0.15 * intensity;
      this.spectators[i].scaleOffset = 0.2 * intensity;
      this.spectators[i].rotX = 15 * (Math.PI / 180);
    }
  }

  update(dt) {
    if (!this.mesh) return;
    this.time += dt;

    if (this.state === "WILD") {
      this.wildTimer -= dt;
      if (this.wildTimer <= 0) {
        this.state = "IDLE";
      }
    } else if (this.state === "KNOCKOUT_REACTION") {
      this.knockoutTimer -= dt;
      if (this.knockoutTimer <= 0) {
        this.state = "IDLE";
      }
    }

    for (let i = 0; i < this.spectators.length; i++) {
      const spec = this.spectators[i];
      const basePos = this.basePositions[i];
      const baseScale = this.baseScales[i];

      let targetYOffset = 0;
      let targetScaleOffset = 0;

      if (this.state === "IDLE") {
        targetYOffset =
          Math.sin(
            this.time * Math.PI * 2 * this.frequencies[i] + this.phases[i],
          ) * 0.04;
      } else if (this.state === "WILD") {
        targetYOffset =
          Math.sin(this.time * Math.PI * 2 * 2.0 + this.phases[i]) * 0.2;
        targetScaleOffset =
          Math.sin(this.time * Math.PI * 2 * 1.5 + this.phases[i]) * 0.125 +
          0.125;
      } else if (this.state === "KNOCKOUT_REACTION") {
        targetYOffset =
          Math.sin(this.time * Math.PI * 2 * 2.0 + this.phases[i]) * 0.2;
        targetScaleOffset =
          Math.sin(this.time * Math.PI * 2 * 1.5 + this.phases[i]) * 0.125 +
          0.125;
        // if (this.knockoutTimer < 1.0) targetScaleOffset = 0;
        // else targetScaleOffset = 0.4;
      }

      const yStep = springStep(
        spec.yOffset,
        targetYOffset,
        spec.yVel,
        100,
        0.8,
        dt,
      );
      spec.yOffset = yStep.value;
      spec.yVel = yStep.velocity;

      const scaleStep = springStep(
        spec.scaleOffset,
        targetScaleOffset,
        spec.scaleVel,
        100,
        0.8,
        dt,
      );
      spec.scaleOffset = scaleStep.value;
      spec.scaleVel = scaleStep.velocity;

      spec.rotX = spec.rotX * Math.exp(-5 * dt);

      this.dummy.position.set(basePos.x, basePos.y + spec.yOffset, basePos.z);
      const s = baseScale + spec.scaleOffset;
      this.dummy.scale.set(s, s, s);
      this.dummy.rotation.set(spec.rotX, spec.rotY, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
