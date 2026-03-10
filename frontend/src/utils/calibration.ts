/** Affine transform calibration: pixel ↔ room coordinate conversion.
 *
 *  x_room = m00*x_px + m01*y_px + tx
 *  y_room = m10*x_px + m11*y_px + ty
 *
 * Solved via least-squares from 3+ reference point pairs. */

export interface AffineParams {
  m00: number;
  m01: number;
  m10: number;
  m11: number;
  tx: number;
  ty: number;
}

export interface CalibrationPoint {
  /** Pixel coordinate on the canvas */
  px: number;
  py: number;
  /** Real-world room coordinate in meters */
  rx: number;
  ry: number;
}

export interface CalibrationState {
  points: CalibrationPoint[];
  affine: AffineParams | null;
  inverse: AffineParams | null;
  error: number;
}

const IDENTITY: AffineParams = { m00: 1, m01: 0, m10: 0, m11: 1, tx: 0, ty: 0 };

/** Solve the 2D affine transform from pixel→room using least squares.
 *  Requires at least 3 non-collinear point pairs.
 *  Returns null if the system is degenerate. */
export function solveAffineTransform(points: CalibrationPoint[]): AffineParams | null {
  if (points.length < 3) return null;

  const n = points.length;

  // Build normal equations for:  [x_room] = [m00 m01 tx] [px]
  //                               [y_room]   [m10 m11 ty] [py]
  //                                                        [1 ]
  // We solve two independent systems (one for x_room, one for y_room):
  //   A * [m00, m01, tx]^T = bx
  //   A * [m10, m11, ty]^T = by
  // where each row of A is [px_i, py_i, 1].

  // 3x3 normal matrix: A^T * A
  let s_xx = 0, s_xy = 0, s_x = 0;
  let s_yy = 0, s_y = 0;
  let s_1 = n;
  // Right-hand sides
  let s_xrx = 0, s_yrx = 0, s_rx = 0;
  let s_xry = 0, s_yry = 0, s_ry = 0;

  for (const p of points) {
    s_xx += p.px * p.px;
    s_xy += p.px * p.py;
    s_x  += p.px;
    s_yy += p.py * p.py;
    s_y  += p.py;
    // bx components
    s_xrx += p.px * p.rx;
    s_yrx += p.py * p.rx;
    s_rx  += p.rx;
    // by components
    s_xry += p.px * p.ry;
    s_yry += p.py * p.ry;
    s_ry  += p.ry;
  }

  // Solve 3x3 system via Cramer's rule for both RHS
  const detA =
    s_xx * (s_yy * s_1 - s_y * s_y) -
    s_xy * (s_xy * s_1 - s_y * s_x) +
    s_x  * (s_xy * s_y - s_yy * s_x);

  if (Math.abs(detA) < 1e-12) return null; // degenerate

  const invDet = 1 / detA;

  // Cofactors of normal matrix
  const c00 = s_yy * s_1 - s_y * s_y;
  const c01 = -(s_xy * s_1 - s_y * s_x);
  const c02 = s_xy * s_y - s_yy * s_x;
  const c10 = -(s_xy * s_1 - s_x * s_y);
  const c11 = s_xx * s_1 - s_x * s_x;
  const c12 = -(s_xx * s_y - s_xy * s_x);
  const c20 = s_xy * s_y - s_x * s_yy;
  const c21 = -(s_xx * s_y - s_x * s_xy);
  const c22 = s_xx * s_yy - s_xy * s_xy;

  const m00 = (c00 * s_xrx + c01 * s_yrx + c02 * s_rx) * invDet;
  const m01 = (c10 * s_xrx + c11 * s_yrx + c12 * s_rx) * invDet;
  const tx  = (c20 * s_xrx + c21 * s_yrx + c22 * s_rx) * invDet;
  const m10 = (c00 * s_xry + c01 * s_yry + c02 * s_ry) * invDet;
  const m11 = (c10 * s_xry + c11 * s_yry + c12 * s_ry) * invDet;
  const ty  = (c20 * s_xry + c21 * s_yry + c22 * s_ry) * invDet;

  return { m00, m01, m10, m11, tx, ty };
}

/** Compute the inverse affine (room→pixel). Returns null if non-invertible. */
export function invertAffine(a: AffineParams): AffineParams | null {
  const det = a.m00 * a.m11 - a.m01 * a.m10;
  if (Math.abs(det) < 1e-12) return null;
  const id = 1 / det;
  return {
    m00:  a.m11 * id,
    m01: -a.m01 * id,
    m10: -a.m10 * id,
    m11:  a.m00 * id,
    tx: (a.m01 * a.ty - a.m11 * a.tx) * id,
    ty: (a.m10 * a.tx - a.m00 * a.ty) * id,
  };
}

/** Convert pixel coordinate to room coordinate (meters). */
export function pixelToRoom(px: number, py: number, a: AffineParams): { x: number; y: number } {
  return {
    x: a.m00 * px + a.m01 * py + a.tx,
    y: a.m10 * px + a.m11 * py + a.ty,
  };
}

/** Convert room coordinate (meters) to pixel coordinate. */
export function roomToPixel(rx: number, ry: number, inv: AffineParams): { x: number; y: number } {
  return {
    x: inv.m00 * rx + inv.m01 * ry + inv.tx,
    y: inv.m10 * rx + inv.m11 * ry + inv.ty,
  };
}

/** Compute calibration RMS error in meters. */
export function calibrationError(points: CalibrationPoint[], a: AffineParams): number {
  if (points.length === 0) return 0;
  let sumSq = 0;
  for (const p of points) {
    const r = pixelToRoom(p.px, p.py, a);
    sumSq += (r.x - p.rx) ** 2 + (r.y - p.ry) ** 2;
  }
  return Math.sqrt(sumSq / points.length);
}

/** Get identity calibration (1:1 pixel=meter). */
export function identityCalibration(): CalibrationState {
  return { points: [], affine: IDENTITY, inverse: IDENTITY, error: 0 };
}

/** Compute full calibration state from reference points.
 *  Returns identity if fewer than 3 points. */
export function computeCalibration(points: CalibrationPoint[]): CalibrationState {
  if (points.length < 3) {
    return { points, affine: null, inverse: null, error: Infinity };
  }
  const affine = solveAffineTransform(points);
  if (!affine) {
    return { points, affine: null, inverse: null, error: Infinity };
  }
  const inverse = invertAffine(affine);
  const error = calibrationError(points, affine);
  return { points, affine, inverse, error };
}

/** Snap a coordinate to the nearest grid line. */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Serialize calibration to JSON-safe object. */
export function serializeCalibration(cal: CalibrationState): object {
  return {
    points: cal.points,
    affine: cal.affine,
    error: cal.error,
  };
}

/** Deserialize calibration from stored JSON. */
export function deserializeCalibration(data: unknown): CalibrationState {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") return identityCalibration();

  const points = Array.isArray(d.points) ? (d.points as CalibrationPoint[]) : [];
  if (d.affine && typeof d.affine === "object") {
    const a = d.affine as AffineParams;
    const inverse = invertAffine(a);
    const error = typeof d.error === "number" ? d.error : calibrationError(points, a);
    return { points, affine: a, inverse, error };
  }
  return computeCalibration(points);
}
