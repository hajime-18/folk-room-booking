// fake-firebase.js
// app.js が呼び出すFirebase関数群を模倣したテスト用モック。
// 本物のFirestore/Authエミュレータには接続できない環境のため、
// セキュリティルールと同等の制約をこの中でも再現し、app.js側の
// 呼び出し方(引数・戻り値の扱い)に誤りがないかを検証する。

function randomId(){
  return Math.random().toString(36).slice(2, 12);
}

export function createFakeFirebase(){
  const usersByEmail = new Map(); // email -> { uid, email, password }
  const usersByUid = new Map();
  let currentUser = null;
  const authListeners = [];

  const bandsData = new Map();       // id -> data
  const reservationsData = new Map(); // id -> data
  const bandsListeners = [];
  const reservationsListeners = [];

  function notifyAuth(){
    authListeners.forEach(cb => cb(currentUser));
  }
  function notifyBands(){
    const docs = Array.from(bandsData.entries()).map(([id, data]) => ({ id, data: () => data }));
    bandsListeners.forEach(cb => cb({ docs }));
  }
  function notifyReservations(){
    const docs = Array.from(reservationsData.entries()).map(([id, data]) => ({ id, data: () => data }));
    reservationsListeners.forEach(cb => cb({ docs }));
  }

  const auth = {
    get currentUser(){ return currentUser; },
  };

  async function createUserWithEmailAndPassword(_auth, email, password){
    if (usersByEmail.has(email)){
      const err = new Error('email already in use'); err.code = 'auth/email-already-in-use'; throw err;
    }
    const uid = randomId();
    const user = { uid, email, password };
    usersByEmail.set(email, user);
    usersByUid.set(uid, user);
    currentUser = { uid, email };
    notifyAuth();
    return { user: currentUser };
  }

  async function signInWithEmailAndPassword(_auth, email, password){
    const user = usersByEmail.get(email);
    if (!user || user.password !== password){
      const err = new Error('invalid credential'); err.code = 'auth/invalid-credential'; throw err;
    }
    currentUser = { uid: user.uid, email: user.email };
    notifyAuth();
    return { user: currentUser };
  }

  async function signOut(){
    currentUser = null;
    notifyAuth();
  }

  function onAuthStateChanged(_auth, cb){
    authListeners.push(cb);
    cb(currentUser);
    return () => {
      const i = authListeners.indexOf(cb);
      if (i >= 0) authListeners.splice(i, 1);
    };
  }

  async function deleteUser(user){
    const rec = usersByUid.get(user.uid);
    if (rec){
      usersByUid.delete(user.uid);
      usersByEmail.delete(rec.email);
    }
    if (currentUser && currentUser.uid === user.uid){
      currentUser = null;
      notifyAuth();
    }
  }

  function collection(_db, name){ return { name }; }
  function doc(_db, name, id){ return { name, id }; }

  function requireAuth(){
    if (!currentUser){
      const err = new Error('permission-denied: not signed in'); err.code = 'permission-denied'; throw err;
    }
  }

  async function setDoc(ref, data){
    if (ref.name === 'bands'){
      requireAuth();
      if (currentUser.uid !== ref.id){
        const err = new Error('permission-denied: uid mismatch'); err.code = 'permission-denied'; throw err;
      }
      const allowedKeys = ['name', 'nameLower', 'note', 'authEmail', 'createdAt'];
      const keys = Object.keys(data);
      if (!keys.every(k => allowedKeys.includes(k))){
        const err = new Error('permission-denied: unexpected fields'); err.code = 'permission-denied'; throw err;
      }
      if (typeof data.name !== 'string' || data.name.length === 0 || data.name.length > 30){
        const err = new Error('permission-denied: invalid name'); err.code = 'permission-denied'; throw err;
      }
      bandsData.set(ref.id, data);
      notifyBands();
      return;
    }
    throw new Error('setDoc: unsupported collection ' + ref.name);
  }

  async function addDoc(colRef, data){
    if (colRef.name === 'reservations'){
      requireAuth();
      if (data.bandId !== currentUser.uid){
        const err = new Error('permission-denied: bandId mismatch'); err.code = 'permission-denied'; throw err;
      }
      const allowedKeys = ['bandId', 'bandName', 'date', 'start', 'end', 'createdAt'];
      const keys = Object.keys(data);
      if (!keys.every(k => allowedKeys.includes(k))){
        const err = new Error('permission-denied: unexpected fields'); err.code = 'permission-denied'; throw err;
      }
      if (!(data.end > data.start) || (data.end - data.start) > 120 || (data.end - data.start) % 30 !== 0){
        const err = new Error('permission-denied: invalid time range'); err.code = 'permission-denied'; throw err;
      }
      const id = randomId();
      reservationsData.set(id, data);
      notifyReservations();
      return { id };
    }
    throw new Error('addDoc: unsupported collection ' + colRef.name);
  }

  async function deleteDoc(ref){
    if (ref.name === 'bands'){
      requireAuth();
      if (currentUser.uid !== ref.id){
        const err = new Error('permission-denied'); err.code = 'permission-denied'; throw err;
      }
      bandsData.delete(ref.id);
      notifyBands();
      return;
    }
    if (ref.name === 'reservations'){
      requireAuth();
      const existing = reservationsData.get(ref.id);
      if (!existing || existing.bandId !== currentUser.uid){
        const err = new Error('permission-denied'); err.code = 'permission-denied'; throw err;
      }
      reservationsData.delete(ref.id);
      notifyReservations();
      return;
    }
    throw new Error('deleteDoc: unsupported collection ' + ref.name);
  }

  function onSnapshot(ref, onNext, onError){
    if (ref.name === 'bands'){
      bandsListeners.push(onNext);
      const docs = Array.from(bandsData.entries()).map(([id, data]) => ({ id, data: () => data }));
      onNext({ docs });
      return () => {};
    }
    if (ref.name === 'reservations'){
      reservationsListeners.push(onNext);
      const docs = Array.from(reservationsData.entries()).map(([id, data]) => ({ id, data: () => data }));
      onNext({ docs });
      return () => {};
    }
    throw new Error('onSnapshot: unsupported collection ' + ref.name);
  }

  function serverTimestamp(){ return { __serverTimestamp: true }; }

  return {
    auth, db: {},
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, deleteUser,
    collection, doc, setDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp,
    _debug: { bandsData, reservationsData, usersByEmail },
  };
}
