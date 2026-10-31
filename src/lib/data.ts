// Types for data.json, which tools/build_data.py generates from the GPX files and the official closure list.
import json from './data.json';

export type LngLat = [number, number];

export type Closure = {
  n: number; // closure number, also its index in the list
  streets: string;
  close: string; // HH:MM on race day
  open: string;
  line: LngLat[];
  label: LngLat; // middle of the chunk, for the badge
};

export type Data = {
  routes: { marathon: LngLat[]; '10k': LngLat[]; '5k': LngLat[] };
  closures: Closure[];
  markers: { km: number; at: LngLat }[];
};

export default json as Data;
