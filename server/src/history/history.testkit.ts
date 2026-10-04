// The history modules as their tests see them. Written ahead of the modules,
// this loaded them at run time, so each test could show red on its own; the
// tests still treat them as untyped (fixtures are plain objects, records
// are poked at freely), as room tests do with `any` rooms.
import * as recorder from "./recorder";
import * as routes from "./routes";
import * as store from "./store";

export function recorderModule(): any {
  return recorder;
}

export function storeModule(): any {
  return store;
}

export function routesModule(): any {
  return routes;
}
