import { useCallback, useEffect, useState } from 'react';
import { FeedbackMount } from './FeedbackMount';
import { ImportPage } from './ImportPage';
import { Landing } from './Landing';
import { ProjectPage } from './ProjectPage';
import './app.css';

// 화면이 두 개뿐이라 라우터 라이브러리 없이 pathname 만 본다(의존성 추가는 S1 몫이기도 하다)
const PROJECT_PATH = /^\/p\/([^/]+)\/?$/;
export const NEW_PATH = '/new';

export type Navigate = (to: string) => void;

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback<Navigate>((to) => {
    window.history.pushState(null, '', to);
    setPath(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);

  const match = PROJECT_PATH.exec(path);
  return (
    <>
      {match ? (
        <ProjectPage key={match[1]} id={decodeURIComponent(match[1])} navigate={navigate} />
      ) : path === NEW_PATH ? (
        <ImportPage navigate={navigate} />
      ) : (
        <Landing navigate={navigate} />
      )}
      <FeedbackMount />
    </>
  );
}
