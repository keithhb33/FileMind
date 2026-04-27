/// <reference types="vite/client" />

import type { FileMindApi } from "../../shared/types";

declare global {
  interface Window {
    fileMind: FileMindApi;
  }
}
