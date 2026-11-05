// Shared read-only validation for the original first-party forum mapping.
export function forumUrl(value){
 try{const u=new URL(value);return u.origin==='https://enterscholar.com'&&!u.username&&!u.password&&/^\/t\/(?:[^/]+\/)?\d+\/?$/.test(u.pathname)&&!u.search&&!u.hash?u.href:null;}catch{return null;}
}
