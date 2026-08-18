

const ENVIRONMENTS = {
  "potaetoe.github.io": {
    name: "production",
    endpoint: "https://hgbinderworker.sorcererbiggz.workers.dev",

     
     
     
     
     
     
     
     
     
    publicKey: "BEKFlvIzxk0/nOTskgzbKfYoqmMW3ds4EmUpn6rqx9rD1d5PhnxXT9kD917khzW07MUT2yAX18Wc7rD4K0BTSQ8=",
  },
  "localhost": {
    name: "development",
    endpoint: "https://hgbinderworker-dev.sorcererbiggz.workers.dev",

     
     
    publicKey: "BL4L1Ap1ZybmyIfJ8wJuaV1hUMtTmtMPaE//xgG5GdS5tH8Atk24MqkwNaVx5OMST/OsDWMJ5l4fSsvlFKZKyrc=",
  },
  "hgbinderworker-sit.sorcererbiggz.workers.dev": {
    name: "sit",

     
     
     
     
     
     
    endpoint: "https://hgbinderworker-sit.sorcererbiggz.workers.dev",

     
     
     
     
     
    publicKey: null,
  },
};

ENVIRONMENTS["127.0.0.1"] = ENVIRONMENTS.localhost;

 
 
 
 
 
 
 
 
 
 
 
 
 
 
globalThis.BINDER_CONFIG = Object.freeze(
  ENVIRONMENTS[location.hostname] || {
    name: "unknown",
    publicKey: null,
  }
);

Object.defineProperty(globalThis, "BINDER_CONFIG", {
  writable: false,
  configurable: false,
});
