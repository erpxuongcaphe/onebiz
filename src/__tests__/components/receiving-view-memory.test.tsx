import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {useState} from 'react';
import {z} from 'zod';
import {useReceivingViewMemory} from '@/lib/hooks/use-receiving-view-memory';

const schema=z.object({page:z.number().min(0),search:z.string(),sort:z.string()});
const initial={page:0,search:'',sort:'newest'};
function Harness({memoryKey,loading=false}:{memoryKey:string;loading?:boolean}){
  const [state,setState]=useState(initial);
  const memory=useReceivingViewMemory({key:memoryKey,snapshot:state,initial,schema,restore:setState,loading});
  return <div data-testid="scroller" style={{overflowY:'auto',height:100}}><div ref={memory.containerRef}>
    <output>{memory.ready?JSON.stringify(state):'loading'}</output>
    <button onClick={()=>setState({page:3,search:'Sữa',sort:'oldest'})}>Change</button>
  </div></div>;
}
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal('scrollTo',vi.fn());});
afterEach(()=>vi.unstubAllGlobals());
describe('scoped receiving list memory',()=>{
  it('restores filters, sorting, page and scroll position only after data loads',async()=>{
    const first=render(<Harness memoryKey="tenant:user:branch:internal"/>);
    fireEvent.click(screen.getByRole('button',{name:'Change'}));
    const scroller=screen.getByTestId('scroller');
    scroller.scrollTop=280;fireEvent.scroll(scroller);
    first.unmount();
    const second=render(<Harness memoryKey="tenant:user:branch:internal" loading/>);
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('"page":3'));
    expect(screen.getByTestId('scroller').scrollTop).toBe(0);
    second.rerender(<Harness memoryKey="tenant:user:branch:internal" loading={false}/>);
    await waitFor(()=>expect(screen.getByTestId('scroller').scrollTop).toBe(280));
    expect(screen.getByRole('status')).toHaveTextContent('"sort":"oldest"');
  });
  it('does not overwrite the previous scope or leak its filters on branch/account changes',async()=>{
    const view=render(<Harness memoryKey="tenant:user:branch-A:internal"/>);
    fireEvent.click(screen.getByRole('button',{name:'Change'}));
    view.rerender(<Harness memoryKey="tenant:user:branch-B:internal"/>);
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('"page":0'));
    expect(JSON.parse(sessionStorage.getItem('tenant:user:branch-A:internal')!).data.page).toBe(3);
    expect(JSON.parse(sessionStorage.getItem('tenant:user:branch-B:internal')!).data.search).toBe('');
  });
  it('ignores expired or malformed state and tolerates storage restrictions',async()=>{
    sessionStorage.setItem('bad',JSON.stringify({version:1,expiresAt:0,data:{...initial,page:9}}));
    const view=render(<Harness memoryKey="bad"/>);
    expect(screen.getByRole('status')).toHaveTextContent('"page":0');
    sessionStorage.setItem('invalid','{');
    view.rerender(<Harness memoryKey="invalid"/>);
    await waitFor(()=>expect(screen.getByRole('status')).toHaveTextContent('"page":0'));
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});
    act(()=>fireEvent.click(screen.getByRole('button',{name:'Change'})));
    expect(screen.getByRole('status')).toHaveTextContent('"page":3');
    vi.restoreAllMocks();
  });
});
