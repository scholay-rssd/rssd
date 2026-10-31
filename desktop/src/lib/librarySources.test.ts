import {expect,it} from 'vitest';
import {librarySourceNames} from '../editorial/librarySources';

it('uses the device and connection names without exposing URL credentials or paths',()=>{
 expect(librarySourceNames('  Isaac 的 Mac Studio\n','https://user:secret@today.scholay.com/admin?token=private')).toEqual({local:'Isaac 的 Mac Studio',cloud:'today.scholay.com'});
 expect(librarySourceNames('OFFICE-PC','http://127.0.0.1:8080/')).toMatchObject({local:'OFFICE-PC',cloud:'127.0.0.1:8080'});
});

it('uses safe fallbacks for absent names or non-web connections',()=>{
 for(const origin of ['', 'not a URL', 'file:///private/path', 'javascript:alert(1)']){
  expect(librarySourceNames('\n\u0000 ',origin)).toEqual({local:'本机',cloud:'未连接云端'});
 }
});
