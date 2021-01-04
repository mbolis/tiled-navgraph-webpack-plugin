const QuadTree = require("@timohausmann/quadtree-js");

class Vector {
  constructor(xOrVector = 0, y = 0) {
    if (xOrVector instanceof Vector) {
      const vector = xOrVector;
      this.x = vector.x;
      this.y = vector.y;
    } else {
      const x = xOrVector;
      this.x = x;
      this.y = y;
    }
  }

  dotProduct({ x, y }) {
    return this.x * x + this.y * y;
  }

  add({ x, y }) {
    this.x += x;
    this.y += y;

    return this;
  }

  sub({ x, y }) {
    this.x -= x;
    this.y -= y;

    return this;
  }

  perp() {
    const x = this.x;
    this.x = this.y;
    this.y = -x;

    return this;
  }

  div(n) {
    this.x /= n;
    this.y /= n;

    return this;
  }

  get length2() {
    return this.dotProduct(this);
  }

  get length() {
    return Math.sqrt(this.length2);
  }

  distance({ x, y }) {
    return Math.sqrt((this.x - x) ** 2 + (this.y - y) ** 2);
  }

  normalize() {
    return this.div(this.length);
  }

  abs() {
    if (this.x < 0) this.x *= -1;
    if (this.y < 0) this.y *= -1;

    return this;
  }
}

class Line {
  constructor(p1, p2) {
    this.points = [p1, p2];

    const edge = new Vector(p2).sub(p1);
    this.normals = [new Vector(edge).perp().normalize()];

    this.bounds = new Rect(p1, p2);
  }
}

const RECT_KEYS = [/*"x", "y",*/ "width", "height"];
const isRect = (obj) => typeof obj === "object" && RECT_KEYS.every((k) => k in obj);

class Rect {
  constructor(xOrP1OrRect = 0, yOrP2 = 0, width = 0, height = 0) {
    if (isRect(xOrP1OrRect)) {
      const rect = xOrP1OrRect;
      this.x = rect.x || 0;
      this.y = rect.y || 0;
      this.width = rect.width;
      this.height = rect.height;
    } else if (xOrP1OrRect instanceof Vector && yOrP2 instanceof Vector) {
      const p1 = xOrP1OrRect;
      const p2 = yOrP2;

      this.x = Math.min(p1.x, p2.x);
      this.y = Math.min(p1.y, p2.y);

      const delta = new Vector(p2).sub(p1).abs();

      this.width = delta.x;
      this.height = delta.y;
    } else {
      const x = xOrP1OrRect;
      const y = yOrP2;

      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }

    this.points = [
      new Vector(this.x, this.y),
      new Vector(this.x + this.width, this.y),
      new Vector(this.x + this.width, this.y + this.height),
      new Vector(this.x, this.y + this.height),
    ];

    this.normals = this.points.map((p, i, ps) => new Vector(ps[(i + 1) % 4]).sub(p).perp().normalize());

    this.left = this.x;
    this.right = this.x + this.width;
    this.top = this.y;
    this.bottom = this.y + this.height;
  }

  overlaps({ top, right, bottom, left }) {
    return this.left < right && left < this.right && this.top < bottom && top < this.bottom;
  }

  union({ top, right, bottom, left }) {
    const x = Math.min(this.left, left);
    const y = Math.min(this.top, top);
    const width = Math.max(this.right, right) - x;
    const height = Math.max(this.bottom, bottom) - y;

    return new Rect(x, y, width, height);
  }

  intersect({ top, right, bottom, left }) {
    if (this.top >= top && this.right <= right && this.bottom <= bottom && this.left >= left) {
      return this;
    }

    const x = Math.max(this.left, left);
    const y = Math.max(this.top, top);
    const width = Math.min(this.right, right) - x;
    const height = Math.min(this.bottom, bottom) - y;

    return new Rect(x, y, width, height);
  }
}

function flattenPointsOn(points, normal) {
  var min = Number.MAX_VALUE;
  var max = -Number.MAX_VALUE;
  var len = points.length;
  for (var i = 0; i < len; i++) {
    // The magnitude of the projection of the point onto the normal
    var dot = points[i].dotProduct(normal);
    if (dot < min) {
      min = dot;
    }
    if (dot > max) {
      max = dot;
    }
  }
  return [min, max];
}

function isSeparatingAxis(aPoints, bPoints, axis) {
  // Project the polygons onto the axis.
  const rangeA = flattenPointsOn(aPoints, axis);
  const rangeB = flattenPointsOn(bPoints, axis);

  // The magnitude of the offset between the two polygons
  //const offsetV = new Vector(bPos).sub(aPos);
  const projectedOffset = new Vector().dotProduct(axis);
  // Move B's range to its position relative to A.
  rangeB[0] += projectedOffset;
  rangeB[1] += projectedOffset;

  // Check if there is a gap. If there is, this is a separating axis and we can stop
  return rangeA[0] > rangeB[1] || rangeB[0] > rangeA[1];
}

function testShapes(polyA, polyB) {
  const aPoints = polyA.points;
  const aNormals = polyA.normals;
  const aLen = aNormals.length;

  const bPoints = polyB.points;
  const bNormals = polyB.normals;
  const bLen = bNormals.length;

  // If any of the edge normals of A is a separating axis, no intersection.
  for (let i = 0; i < aLen; i++) {
    if (isSeparatingAxis(aPoints, bPoints, aNormals[i])) {
      return false;
    }
  }

  // If any of the edge normals of B is a separating axis, no intersection.
  for (let i = 0; i < bLen; i++) {
    if (isSeparatingAxis(aPoints, bPoints, bNormals[i])) {
      return false;
    }
  }

  return true;
}

class Container extends QuadTree {
  constructor(obstacles) {
    obstacles = obstacles.map((o) => new Rect(o));
    super(obstacles.reduce((bounds, o) => bounds.union(o), new Rect()));
    obstacles.forEach((o) => this.insert(o));

    this.broadphase = [];
  }

  rayCast(line) {
    // retrieve a list of potential colliding objects
    const candidates = this.retrieve(line.bounds);
    this.broadphase.push({ line, candidates });

    const result = [];
    for (let obstacle of candidates) {
      // fast AABB check if both bounding boxes are overlapping
      if (line.bounds.overlaps(obstacle)) {
        // full SAT collision check
        if (testShapes(line, obstacle)) {
          // we touched something !
          result.push(obstacle);
        }
      }
    }

    return result;
  }

  hasLOS(line) {
    return this.rayCast(line).length === 0;
  }

  hasFreeLOS([p1, p2], pad = 0) {
    if (pad) {
      return (
        this.hasLOS(new Line(p1, p2)) &&
        this.hasLOS(new Line(new Vector(+pad, +pad).add(p1), new Vector(+pad, +pad).add(p2))) &&
        this.hasLOS(new Line(new Vector(-pad, +pad).add(p1), new Vector(-pad, +pad).add(p2))) &&
        this.hasLOS(new Line(new Vector(-pad, -pad).add(p1), new Vector(-pad, -pad).add(p2))) &&
        this.hasLOS(new Line(new Vector(+pad, -pad).add(p1), new Vector(+pad, -pad).add(p2)))
      );
    }

    return this.hasLOS(new Line(p1, p2));
  }
}

module.exports = Container;
Object.assign(module.exports, {
  Vector,
  Line,
  Rect,
});
