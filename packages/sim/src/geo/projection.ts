/**
 * Oblique stereographic projection centred on a sector reference point — the
 * projection radar displays use (conformal, so angles on the scope are true).
 *
 * Implemented with proj4 (MIT), EPSG method 9809 ("sterea") on WGS-84. Local
 * coordinates are metres east (x) and north (y) of the reference point. Scale
 * error is below 0.1 % within ~120 NM of the centre, which is the size of an
 * approach sector; larger areas should use a reference point near their middle.
 *
 * No paid alternative is needed here.
 */
import proj4 from 'proj4';
import type { LatLon } from './geodesy';

export interface LocalXY {
  /** Metres east of the reference point. */
  x: number;
  /** Metres north of the reference point. */
  y: number;
}

export class StereographicProjection {
  readonly origin: LatLon;
  private readonly converter: proj4.Converter;

  constructor(origin: LatLon) {
    this.origin = { ...origin };
    const def =
      `+proj=sterea +lat_0=${origin.lat} +lon_0=${origin.lon} +k=1 ` +
      '+x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
    this.converter = proj4('EPSG:4326', def);
  }

  toLocal(p: LatLon): LocalXY {
    const [x, y] = this.converter.forward([p.lon, p.lat]) as [number, number];
    return { x, y };
  }

  toGeo(p: LocalXY): LatLon {
    const [lon, lat] = this.converter.inverse([p.x, p.y]) as [number, number];
    return { lat, lon };
  }
}
