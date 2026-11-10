/**
 * Three.js Standalone Lightweight Modular Build for MyGyM PWA
 * Pinned offline-first WebGL & 3D Math Engine (Zero external dependencies)
 * Supports Scene, Camera, WebGLRenderer, Geometries, Materials, Lights, Raycasting & Disposal
 */

// ---- Math Utilities ----
export const MathUtils = {
  DEG2RAD: Math.PI / 180,
  RAD2DEG: 180 / Math.PI,
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },
  degToRad(degrees) {
    return degrees * this.DEG2RAD;
  },
  radToDeg(radians) {
    return radians * this.RAD2DEG;
  },
  lerp(x, y, t) {
    return (1 - t) * x + t * y;
  }
};

// ---- Color ----
export class Color {
  constructor(r = 1, g = 1, b = 1) {
    this.isColor = true;
    if (typeof r === 'number' && g === undefined && b === undefined) {
      this.setHex(r);
    } else if (typeof r === 'string') {
      this.setStyle(r);
    } else {
      this.r = r;
      this.g = g;
      this.b = b;
    }
  }

  set(r, g, b) {
    if (typeof r === 'number' && g === undefined) return this.setHex(r);
    if (typeof r === 'string') return this.setStyle(r);
    this.r = r; this.g = g; this.b = b;
    return this;
  }

  setHex(hex) {
    hex = Math.floor(hex);
    this.r = ((hex >> 16) & 255) / 255;
    this.g = ((hex >> 8) & 255) / 255;
    this.b = (hex & 255) / 255;
    return this;
  }

  getHex() {
    return (Math.round(this.r * 255) << 16) ^ (Math.round(this.g * 255) << 8) ^ (Math.round(this.b * 255) << 0);
  }

  setStyle(style) {
    if (style.startsWith('#')) {
      let hex = style.slice(1);
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      return this.setHex(parseInt(hex, 16));
    }
    return this;
  }

  copy(color) {
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;
    return this;
  }

  clone() {
    return new Color(this.r, this.g, this.b);
  }
}

// ---- Vector2 ----
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
}

// ---- Vector3 ----
export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  normalize() {
    const l = this.length();
    return this.multiplyScalar(l > 0 ? 1 / l : 0);
  }

  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  cross(v) {
    return this.crossVectors(this, v);
  }

  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }

  applyQuaternion(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
}

// ---- Quaternion ----
export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w) {
    this.x = x; this.y = y; this.z = z; this.w = w;
    return this;
  }

  copy(q) {
    this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w;
    return this;
  }

  setFromEuler(euler) {
    const x = euler.x, y = euler.y, z = euler.z;
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);

    this.x = s1 * c2 * c3 + c1 * s2 * s3;
    this.y = c1 * s2 * c3 - s1 * c2 * s3;
    this.z = c1 * c2 * s3 + s1 * s2 * c3;
    this.w = c1 * c2 * c3 - s1 * s2 * s3;
    return this;
  }
}

// ---- Euler ----
export class Euler {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    return this;
  }

  copy(euler) {
    this.x = euler.x; this.y = euler.y; this.z = euler.z;
    return this;
  }
}

// ---- Matrix4 ----
export class Matrix4 {
  constructor() {
    this.elements = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  identity() {
    const te = this.elements;
    te[0] = 1; te[4] = 0; te[8] = 0; te[12] = 0;
    te[1] = 0; te[5] = 1; te[9] = 0; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = 1; te[14] = 0;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  copy(m) {
    const te = this.elements;
    const me = m.elements;
    for (let i = 0; i < 16; i++) te[i] = me[i];
    return this;
  }

  multiply(m) {
    return this.multiplyMatrices(this, m);
  }

  multiplyMatrices(a, b) {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];

    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    return this;
  }

  makeTranslation(x, y, z) {
    const te = this.elements;
    te[0] = 1; te[4] = 0; te[8] = 0; te[12] = x;
    te[1] = 0; te[5] = 1; te[9] = 0; te[13] = y;
    te[2] = 0; te[6] = 0; te[10] = 1; te[14] = z;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  makeScale(x, y, z) {
    const te = this.elements;
    te[0] = x; te[4] = 0; te[8] = 0; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = 0; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = z; te[14] = 0;
    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  makeRotationFromEuler(euler) {
    const te = this.elements;
    const x = euler.x, y = euler.y, z = euler.z;
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);

    const ce = c * e, cf = c * f, de = d * e, df = d * f;

    te[0] = ce + df * b;
    te[4] = de * b - cf;
    te[8] = a * d;
    te[12] = 0;

    te[1] = a * f;
    te[5] = a * e;
    te[9] = -b;
    te[13] = 0;

    te[2] = cf * b - de;
    te[6] = df + ce * b;
    te[10] = a * c;
    te[14] = 0;

    te[3] = 0; te[7] = 0; te[11] = 0; te[15] = 1;
    return this;
  }

  makePerspective(left, right, top, bottom, near, far) {
    const te = this.elements;
    const x = 2 * near / (right - left);
    const y = 2 * near / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = -2 * far * near / (far - near);

    te[0] = x; te[4] = 0; te[8] = a; te[12] = 0;
    te[1] = 0; te[5] = y; te[9] = b; te[13] = 0;
    te[2] = 0; te[6] = 0; te[10] = c; te[14] = d;
    te[3] = 0; te[7] = 0; te[11] = -1; te[15] = 0;
    return this;
  }

  compose(position, quaternion, scale) {
    const te = this.elements;
    const x = quaternion.x, y = quaternion.y, z = quaternion.z, w = quaternion.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    const sx = scale.x, sy = scale.y, sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;
    return this;
  }

  invert() {
    const te = this.elements;
    const n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3];
    const n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7];
    const n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11];
    const n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15];

    const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.identity();

    const detInv = 1 / det;
    te[0] = t11 * detInv; te[4] = t12 * detInv; te[8] = t13 * detInv; te[12] = t14 * detInv;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;

    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;

    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;
    return this;
  }
}

// ---- Ray & Raycaster ----
export class Ray {
  constructor(origin = new Vector3(), direction = new Vector3(0, 0, -1)) {
    this.origin = origin;
    this.direction = direction;
  }

  intersectBox(box, target) {
    let tmin = (box.min.x - this.origin.x) / this.direction.x;
    let tmax = (box.max.x - this.origin.x) / this.direction.x;
    if (tmin > tmax) { const temp = tmin; tmin = tmax; tmax = temp; }

    let tymin = (box.min.y - this.origin.y) / this.direction.y;
    let tymax = (box.max.y - this.origin.y) / this.direction.y;
    if (tymin > tymax) { const temp = tymin; tymin = tymax; tymax = temp; }

    if ((tmin > tymax) || (tymin > tmax)) return null;
    if (tymin > tmin) tmin = tymin;
    if (tymax < tmax) tmax = tymax;

    let tzmin = (box.min.z - this.origin.z) / this.direction.z;
    let tzmax = (box.max.z - this.origin.z) / this.direction.z;
    if (tzmin > tzmax) { const temp = tzmin; tzmin = tzmax; tzmax = temp; }

    if ((tmin > tzmax) || (tzmin > tmax)) return null;
    if (tzmin > tmin) tmin = tzmin;
    if (tmin < 0) return null;

    if (target) {
      target.copy(this.direction).multiplyScalar(tmin).add(this.origin);
      return target;
    }
    return tmin;
  }
}

export class Raycaster {
  constructor(origin, direction, near = 0.1, far = 1000) {
    this.ray = new Ray(origin, direction);
    this.near = near;
    this.far = far;
  }

  setFromCamera(coords, camera) {
    // coords: normalized device coordinates (-1 to +1)
    const origin = new Vector3(coords.x, coords.y, -1).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
    const target = new Vector3(coords.x, coords.y, 1).applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
    const direction = target.sub(origin).normalize();
    this.ray.origin.copy(origin);
    this.ray.direction.copy(direction);
  }

  intersectObject(object, recursive = true, intersects = []) {
    if (!object.visible) return intersects;

    if (object.isMesh && object.geometry) {
      const box = object.geometry.boundingBox || object.getBoundingBox();
      if (box) {
        // Transform ray to local mesh coordinates
        const invMat = new Matrix4().copy(object.matrixWorld).invert();
        const localRay = new Ray(
          this.ray.origin.clone().applyMatrix4(invMat),
          new Vector3().copy(this.ray.direction).applyMatrix4(new Matrix4().copy(invMat).makeTranslation(0, 0, 0)).normalize()
        );

        const hit = localRay.intersectBox(box, new Vector3());
        if (hit) {
          const worldHit = hit.clone().applyMatrix4(object.matrixWorld);
          const dist = this.ray.origin.distanceTo(worldHit);
          if (dist >= this.near && dist <= this.far) {
            intersects.push({
              distance: dist,
              point: worldHit,
              object
            });
          }
        }
      }
    }

    if (recursive && object.children) {
      for (const child of object.children) {
        this.intersectObject(child, true, intersects);
      }
    }

    intersects.sort((a, b) => a.distance - b.distance);
    return intersects;
  }

  intersectObjects(objects, recursive = true) {
    const intersects = [];
    for (const obj of objects) {
      this.intersectObject(obj, recursive, intersects);
    }
    return intersects;
  }
}

// ---- Scene Objects ----
export class Object3D {
  constructor() {
    this.id = Math.random();
    this.name = '';
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.userData = {};
  }

  add(object) {
    if (object.parent) object.parent.remove(object);
    object.parent = this;
    this.children.push(object);
    return this;
  }

  remove(object) {
    const idx = this.children.indexOf(object);
    if (idx !== -1) {
      object.parent = null;
      this.children.splice(idx, 1);
    }
    return this;
  }

  traverse(callback) {
    callback(this);
    for (const child of this.children) {
      child.traverse(callback);
    }
  }

  updateMatrix() {
    this.quaternion.setFromEuler(this.rotation);
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }

  updateMatrixWorld(force = false) {
    this.updateMatrix();
    if (!this.parent) {
      this.matrixWorld.copy(this.matrix);
    } else {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    for (const child of this.children) {
      child.updateMatrixWorld(force);
    }
  }

  getBoundingBox() {
    return {
      min: new Vector3(-0.5, -0.5, -0.5),
      max: new Vector3(0.5, 0.5, 0.5)
    };
  }
}

export class Group extends Object3D {
  constructor() {
    super();
    this.type = 'Group';
  }
}

export class Scene extends Object3D {
  constructor() {
    super();
    this.type = 'Scene';
    this.background = null;
  }
}

export class Camera extends Object3D {
  constructor() {
    super();
    this.type = 'Camera';
    this.matrixWorldInverse = new Matrix4();
    this.projectionMatrix = new Matrix4();
    this.projectionMatrixInverse = new Matrix4();
  }

  updateMatrixWorld(force) {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
}

export class PerspectiveCamera extends Camera {
  constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
    super();
    this.type = 'PerspectiveCamera';
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix() {
    const top = this.near * Math.tan(MathUtils.degToRad(this.fov * 0.5));
    const height = 2 * top;
    const width = this.aspect * height;
    const left = -0.5 * width;
    this.projectionMatrix.makePerspective(left, left + width, top, top - height, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  lookAt(x, y, z) {
    if (typeof x === 'object') {
      z = x.z; y = x.y; x = x.x;
    }
    // Simple look-at target
    const dir = new Vector3(x, y, z).sub(this.position).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.asin(MathUtils.clamp(dir.y, -1, 1));
    this.rotation.set(pitch, yaw, 0);
  }
}

// ---- Lights ----
export class Light extends Object3D {
  constructor(color = 0xffffff, intensity = 1) {
    super();
    this.color = new Color(color);
    this.intensity = intensity;
  }
}

export class AmbientLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = 'AmbientLight';
  }
}

export class DirectionalLight extends Light {
  constructor(color, intensity) {
    super(color, intensity);
    this.type = 'DirectionalLight';
    this.position.set(0, 1, 0);
  }
}

// ---- Materials ----
export class Material {
  constructor() {
    this.id = Math.random();
    this.type = 'Material';
    this.visible = true;
    this.transparent = false;
    this.opacity = 1;
    this.color = new Color(0xffffff);
    this.emissive = new Color(0x000000);
    this.roughness = 0.5;
    this.metalness = 0.1;
  }

  dispose() {}
}

export class MeshBasicMaterial extends Material {
  constructor(parameters = {}) {
    super();
    this.type = 'MeshBasicMaterial';
    Object.assign(this, parameters);
    if (parameters.color) this.color = new Color(parameters.color);
  }
}

export class MeshLambertMaterial extends Material {
  constructor(parameters = {}) {
    super();
    this.type = 'MeshLambertMaterial';
    Object.assign(this, parameters);
    if (parameters.color) this.color = new Color(parameters.color);
    if (parameters.emissive) this.emissive = new Color(parameters.emissive);
  }
}

export class MeshStandardMaterial extends Material {
  constructor(parameters = {}) {
    super();
    this.type = 'MeshStandardMaterial';
    Object.assign(this, parameters);
    if (parameters.color) this.color = new Color(parameters.color);
    if (parameters.emissive) this.emissive = new Color(parameters.emissive);
  }
}

// ---- Geometries & Buffer Attributes ----
export class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }

  setXYZ(index, x, y, z) {
    const i = index * this.itemSize;
    this.array[i] = x;
    this.array[i + 1] = y;
    this.array[i + 2] = z;
    return this;
  }

  getXYZ(index) {
    const i = index * this.itemSize;
    return { x: this.array[i], y: this.array[i + 1], z: this.array[i + 2] };
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array, itemSize) {
    super(new Float32Array(array), itemSize);
  }
}

export class BufferGeometry {
  constructor() {
    this.id = Math.random();
    this.attributes = {};
    this.index = null;
    this.boundingBox = null;
  }

  setAttribute(name, attribute) {
    this.attributes[name] = attribute;
    return this;
  }

  getAttribute(name) {
    return this.attributes[name];
  }

  setIndex(indices) {
    this.index = Array.isArray(indices) ? new Uint16Array(indices) : indices;
    return this;
  }

  computeBoundingBox() {
    const pos = this.attributes.position;
    if (!pos) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.array[i * 3], y = pos.array[i * 3 + 1], z = pos.array[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    this.boundingBox = {
      min: new Vector3(minX, minY, minZ),
      max: new Vector3(maxX, maxY, maxZ)
    };
  }

  dispose() {
    this.attributes = {};
    this.index = null;
    this.boundingBox = null;
  }
}

export class BoxGeometry extends BufferGeometry {
  constructor(width = 1, height = 1, depth = 1) {
    super();
    const w = width / 2, h = height / 2, d = depth / 2;
    const positions = [
      // Front
      -w, -h,  d,   w, -h,  d,   w,  h,  d,  -w,  h,  d,
      // Back
      -w, -h, -d,  -w,  h, -d,   w,  h, -d,   w, -h, -d,
      // Top
      -w,  h, -d,  -w,  h,  d,   w,  h,  d,   w,  h, -d,
      // Bottom
      -w, -h, -d,   w, -h, -d,   w, -h,  d,  -w, -h,  d,
      // Right
       w, -h, -d,   w,  h, -d,   w,  h,  d,   w, -h,  d,
      // Left
      -w, -h, -d,  -w, -h,  d,  -w,  h,  d,  -w,  h, -d
    ];
    const normals = [
      0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
     -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
    ];
    const indices = [];
    for (let i = 0; i < 6; i++) {
      const offset = i * 4;
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setIndex(indices);
    this.computeBoundingBox();
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(radiusTop = 0.5, radiusBottom = 0.5, height = 1, radialSegments = 16) {
    super();
    const positions = [];
    const normals = [];
    const indices = [];
    const halfH = height / 2;

    for (let i = 0; i <= radialSegments; i++) {
      const theta = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta), sin = Math.sin(theta);
      // Top
      positions.push(cos * radiusTop, halfH, sin * radiusTop);
      normals.push(cos, 0, sin);
      // Bottom
      positions.push(cos * radiusBottom, -halfH, sin * radiusBottom);
      normals.push(cos, 0, sin);
    }

    for (let i = 0; i < radialSegments; i++) {
      const idx = i * 2;
      indices.push(idx, idx + 1, idx + 2);
      indices.push(idx + 1, idx + 3, idx + 2);
    }

    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setIndex(indices);
    this.computeBoundingBox();
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(radius = 0.5, widthSegments = 12, heightSegments = 8) {
    super();
    const positions = [];
    const normals = [];
    const indices = [];

    for (let y = 0; y <= heightSegments; y++) {
      const v = y / heightSegments;
      const phi = v * Math.PI;
      for (let x = 0; x <= widthSegments; x++) {
        const u = x / widthSegments;
        const theta = u * Math.PI * 2;
        const px = -radius * Math.cos(theta) * Math.sin(phi);
        const py = radius * Math.cos(phi);
        const pz = radius * Math.sin(theta) * Math.sin(phi);

        positions.push(px, py, pz);
        const l = Math.sqrt(px * px + py * py + pz * pz) || 1;
        normals.push(px / l, py / l, pz / l);
      }
    }

    for (let y = 0; y < heightSegments; y++) {
      for (let x = 0; x < widthSegments; x++) {
        const a = (widthSegments + 1) * y + x;
        const b = (widthSegments + 1) * (y + 1) + x;
        const c = (widthSegments + 1) * (y + 1) + x + 1;
        const d = (widthSegments + 1) * y + x + 1;
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    this.setIndex(indices);
    this.computeBoundingBox();
  }
}

export class CapsuleGeometry extends CylinderGeometry {
  constructor(radius = 0.25, length = 0.5, capSubdivisions = 4, radialSegments = 12) {
    super(radius, radius, length, radialSegments);
  }
}

// ---- Mesh ----
export class Mesh extends Object3D {
  constructor(geometry = new BufferGeometry(), material = new MeshStandardMaterial()) {
    super();
    this.isMesh = true;
    this.type = 'Mesh';
    this.geometry = geometry;
    this.material = material;
  }

  getBoundingBox() {
    if (this.geometry) {
      if (!this.geometry.boundingBox) this.geometry.computeBoundingBox();
      return this.geometry.boundingBox;
    }
    return super.getBoundingBox();
  }
}

// ---- WebGL Renderer ----
export class WebGLRenderer {
  constructor(parameters = {}) {
    this.domElement = parameters.canvas || (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    this.antialias = parameters.antialias !== false;
    this.alpha = parameters.alpha !== false;
    this.gl = null;
    this.program = null;
    this.uniforms = {};
    this.attributes = {};
    this.disposed = false;

    if (this.domElement && typeof this.domElement.getContext === 'function') {
      try {
        this.gl = this.domElement.getContext('webgl', { antialias: this.antialias, alpha: this.alpha }) ||
                  this.domElement.getContext('experimental-webgl');
      } catch (_) {
        this.gl = null;
      }
    }

    if (this.gl) {
      this.initGL();
    }
  }

  initGL() {
    const gl = this.gl;
    if (!gl) return;

    // Shaders for Phong / Lambert Lit Rendering
    const vsSource = `
      attribute vec3 position;
      attribute vec3 normal;
      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform mat3 normalMatrix;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      uniform vec3 diffuse;
      uniform vec3 emissive;
      uniform vec3 ambientColor;
      uniform vec3 lightDirection;
      uniform vec3 lightColor;
      uniform float opacity;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 lightDir = normalize(lightDirection);
        float nDotL = max(dot(normal, lightDir), 0.0);
        vec3 lit = ambientColor + lightColor * nDotL;
        vec3 color = diffuse * lit + emissive;
        gl_FragColor = vec4(color, opacity);
      }
    `;

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSource);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSource);
    gl.compileShader(fs);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    this.program = prog;

    this.attributes.position = gl.getAttribLocation(prog, 'position');
    this.attributes.normal = gl.getAttribLocation(prog, 'normal');

    this.uniforms.modelViewMatrix = gl.getUniformLocation(prog, 'modelViewMatrix');
    this.uniforms.projectionMatrix = gl.getUniformLocation(prog, 'projectionMatrix');
    this.uniforms.normalMatrix = gl.getUniformLocation(prog, 'normalMatrix');
    this.uniforms.diffuse = gl.getUniformLocation(prog, 'diffuse');
    this.uniforms.emissive = gl.getUniformLocation(prog, 'emissive');
    this.uniforms.ambientColor = gl.getUniformLocation(prog, 'ambientColor');
    this.uniforms.lightDirection = gl.getUniformLocation(prog, 'lightDirection');
    this.uniforms.lightColor = gl.getUniformLocation(prog, 'lightColor');
    this.uniforms.opacity = gl.getUniformLocation(prog, 'opacity');

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  setSize(width, height) {
    if (!this.domElement) return;
    const pr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
    this.domElement.width = Math.floor(width * pr);
    this.domElement.height = Math.floor(height * pr);
    this.domElement.style.width = width + 'px';
    this.domElement.style.height = height + 'px';
    if (this.gl) {
      this.gl.viewport(0, 0, this.domElement.width, this.domElement.height);
    }
  }

  setClearColor(color, alpha = 1) {
    if (!this.gl) return;
    const c = new Color(color);
    this.gl.clearColor(c.r, c.g, c.b, alpha);
  }

  render(scene, camera) {
    if (!this.gl || !this.program || this.disposed) return;
    const gl = this.gl;

    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    // Extract lighting from scene
    let amb = new Color(0.55, 0.58, 0.62);
    let dirColor = new Color(1.0, 0.98, 0.95);
    let dirVector = new Vector3(0.5, 1.0, 0.8).normalize();

    scene.traverse(node => {
      if (node.isLight) {
        if (node.type === 'AmbientLight') amb = node.color.clone().multiplyScalar(node.intensity || 1);
        else if (node.type === 'DirectionalLight') {
          dirColor = node.color.clone().multiplyScalar(node.intensity || 1);
          dirVector = node.position.clone().normalize();
        }
      }
    });

    gl.uniform3f(this.uniforms.ambientColor, amb.r, amb.g, amb.b);
    gl.uniform3f(this.uniforms.lightColor, dirColor.r, dirColor.g, dirColor.b);
    gl.uniform3f(this.uniforms.lightDirection, dirVector.x, dirVector.y, dirVector.z);
    gl.uniformMatrix4fv(this.uniforms.projectionMatrix, false, camera.projectionMatrix.elements);

    // Render meshes
    const viewMatrix = camera.matrixWorldInverse;
    const modelView = new Matrix4();

    scene.traverse(obj => {
      if (obj.isMesh && obj.visible && obj.geometry && obj.geometry.attributes.position) {
        modelView.multiplyMatrices(viewMatrix, obj.matrixWorld);
        gl.uniformMatrix4fv(this.uniforms.modelViewMatrix, false, modelView.elements);

        const mve = modelView.elements;
        const normMat = new Float32Array([
          mve[0], mve[1], mve[2],
          mve[4], mve[5], mve[6],
          mve[8], mve[9], mve[10]
        ]);
        gl.uniformMatrix3fv(this.uniforms.normalMatrix, false, normMat);

        const mat = obj.material || {};
        const col = mat.color || new Color(0x64748b);
        const em = mat.emissive || new Color(0x000000);
        gl.uniform3f(this.uniforms.diffuse, col.r, col.g, col.b);
        gl.uniform3f(this.uniforms.emissive, em.r, em.g, em.b);
        gl.uniform1f(this.uniforms.opacity, mat.opacity != null ? mat.opacity : 1.0);

        // Upload and bind buffer
        if (!obj.geometry._posBuf) {
          obj.geometry._posBuf = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, obj.geometry._posBuf);
          gl.bufferData(gl.ARRAY_BUFFER, obj.geometry.attributes.position.array, gl.STATIC_DRAW);
        } else {
          gl.bindBuffer(gl.ARRAY_BUFFER, obj.geometry._posBuf);
        }
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, 0, 0);

        if (obj.geometry.attributes.normal) {
          if (!obj.geometry._normBuf) {
            obj.geometry._normBuf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, obj.geometry._normBuf);
            gl.bufferData(gl.ARRAY_BUFFER, obj.geometry.attributes.normal.array, gl.STATIC_DRAW);
          } else {
            gl.bindBuffer(gl.ARRAY_BUFFER, obj.geometry._normBuf);
          }
          gl.enableVertexAttribArray(this.attributes.normal);
          gl.vertexAttribPointer(this.attributes.normal, 3, gl.FLOAT, false, 0, 0);
        }

        if (obj.geometry.index) {
          if (!obj.geometry._idxBuf) {
            obj.geometry._idxBuf = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.geometry._idxBuf);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, obj.geometry.index, gl.STATIC_DRAW);
          } else {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, obj.geometry._idxBuf);
          }
          gl.drawElements(gl.TRIANGLES, obj.geometry.index.length, gl.UNSIGNED_SHORT, 0);
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, obj.geometry.attributes.position.count);
        }
      }
    });
  }

  dispose() {
    this.disposed = true;
    if (this.gl) {
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }
      const ext = this.gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
      this.gl = null;
    }
    if (this.domElement && this.domElement.parentNode) {
      this.domElement.parentNode.removeChild(this.domElement);
    }
  }
}
