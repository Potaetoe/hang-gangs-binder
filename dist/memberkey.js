

(function (root) {
  "use strict";

  const DB_NAME = "hgb-member-key";
  const STORE_NAME = "keys";

  

  const ROW_KEY = "accountId";

  const CURVE = "P-256";
  const RAW_POINT_BYTES = 65;

  

  const ACCOUNT_ID = /^[0-9a-f]{64}$/;

  function subtle() {
    return root.crypto && root.crypto.subtle ? root.crypto.subtle : null;
  }

  function database() {
    try {
      return root.indexedDB || null;
    } catch (error) {
       
       
       
      return null;
    }
  }

  

  function unavailableReason() {
    if (!subtle()) {
      return "this browser has no WebCrypto, so it cannot make a key of " +
        "your own";
    }
    if (!database()) {
      return "this browser keeps no database for this site, so a key of " +
        "your own would not survive the tab";
    }
    return null;
  }

  

  function custodyVerdict(record, accountId) {
    if (record === null || record === undefined) return "generate";
    if (!ACCOUNT_ID.test(String(accountId))) return "erase";
    if (typeof record !== "object") return "erase";
     
     
     
     
    if (record.accountId !== accountId) return "erase";
    const key = record.privateKey;
    if (!key || typeof key !== "object") return "erase";
    if (key.type !== "private") return "erase";
     
     
    if (key.extractable !== false) return "erase";
    

    const raw = record.publicKeyRaw;
    if (Object.prototype.toString.call(raw) !== "[object Uint8Array]") {
      return "erase";
    }
    if (raw.length !== RAW_POINT_BYTES) return "erase";
    for (let i = 0; i < RAW_POINT_BYTES; i++) {
      if (typeof raw[i] !== "number") return "erase";
    }
    return "use";
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      const factory = database();
      if (!factory) {
        reject(new Error("this browser keeps no database for this site"));
        return;
      }
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(STORE_NAME, { keyPath: ROW_KEY });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

   
   
  async function withStore(mode, act) {
    const db = await openDatabase();
    try {
      return await new Promise(function (resolve, reject) {
        const transaction = db.transaction(STORE_NAME, mode);
        const request = act(transaction.objectStore(STORE_NAME));
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error); };
      });
    } finally {
      db.close();
    }
  }

  

  async function requestPersistence() {
    try {
      const storage = root.navigator && root.navigator.storage;
      if (storage && typeof storage.persist === "function") {
        await storage.persist();
      }
    } catch (error) {
       
       
    }
  }

  async function generateFor(accountId) {
    const pair = await subtle().generateKey(
      { name: "ECDH", namedCurve: CURVE }, false, ["deriveBits"]);
    

    const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    if (raw.length !== RAW_POINT_BYTES) {
      throw new Error("this browser produced a public key of an unexpected " +
        "shape, so an entry sealed to it could not be opened");
    }
    return {
      accountId: accountId,
      privateKey: pair.privateKey,
      publicKeyRaw: raw,
      createdAt: new Date().toISOString(),
    };
  }

  function usable(record) {
    return Object.freeze({
      accountId: record.accountId,
      privateKey: record.privateKey,
      publicKeyRaw: record.publicKeyRaw,
      publicKeyBase64: root.btoa(
        String.fromCharCode.apply(null, record.publicKeyRaw)),
      createdAt: record.createdAt,
    });
  }

  

  async function ensure(accountId) {
    if (unavailableReason()) return null;
    if (!ACCOUNT_ID.test(String(accountId))) return null;

    let record = null;
    try {
      record = await withStore("readonly", function (store) {
        return store.get(accountId);
      });
    } catch (error) {
       
       
      return null;
    }

    const verdict = custodyVerdict(record, accountId);
    if (verdict === "use") return usable(record);

    try {
      if (verdict === "erase") {
         
         
         
         
        await withStore("readwrite", function (store) {
          return store.clear();
        });
      }
      const made = await generateFor(accountId);
      await withStore("readwrite", function (store) {
        return store.put(made);
      });
      await requestPersistence();
      return usable(made);
    } catch (error) {
      return null;
    }
  }

  

  function forget() {
    return new Promise(function (resolve) {
      const factory = database();
      if (!factory) {
        resolve(false);
        return;
      }
      let request;
      try {
        request = factory.deleteDatabase(DB_NAME);
      } catch (error) {
        resolve(false);
        return;
      }
      request.onsuccess = function () { resolve(true); };
      request.onerror = function () { resolve(false); };
       
       
       
       
      request.onblocked = function () { resolve(false); };
    });
  }

   
   
   
   
   
   
   
  root.BinderMemberKey = Object.freeze({
    DB_NAME: DB_NAME,
    STORE_NAME: STORE_NAME,
    ROW_KEY: ROW_KEY,
    unavailableReason: unavailableReason,
    custodyVerdict: custodyVerdict,
    ensure: ensure,
    forget: forget,
  });
})(globalThis);
