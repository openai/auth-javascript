import { useLayoutEffect, useState, version as reactVersion } from 'react';
import { version as reactDOMVersion } from 'react-dom';
import { hydrateRoot } from 'react-dom/client';
import type {
  ChatGPTAuthSessionSource,
  ChatGPTAuthSignInAdapter,
  ChatGPTAuthSignInAdapterResult,
} from '@openai/auth';
import { createChatGPTAuth } from '@openai/auth/client';
import {
  ChatGPTAuthProvider,
  ChatGPTProfilePicture,
  ChatGPTSignInButton,
} from '@openai/auth-react';

const state = {
  calls: { dom: 0, react: 0 },
  hydrationErrors: [] as string[],
  sameButton: false,
  reactVersion,
  reactDOMVersion,
};
const resolvers = new Map<string, (result: ChatGPTAuthSignInAdapterResult) => void>();
function adapter(kind: 'dom' | 'react'): ChatGPTAuthSignInAdapter {
  return {
    signIn() {
      state.calls[kind]++;
      return new Promise((resolve) => resolvers.set(kind, resolve));
    },
  };
}
const reactAdapter = adapter('react');
const session: ChatGPTAuthSessionSource = {
  async getSession() {
    return {
      status: 'authenticated',
      profile: { subject: 'csp', picture: `${location.origin}/profile-picture.svg` },
    };
  },
};
let resize: (size: number) => void = () => {};
const originalButton = document.getElementById('csp-react');
function Fixture() {
  const [size, setSize] = useState(48);
  useLayoutEffect(() => {
    resize = setSize;
    state.sameButton = document.getElementById('csp-react') === originalButton;
  }, []);
  return (
    <ChatGPTAuthProvider options={{ adapter: reactAdapter, session }} stylesheet="external">
      <ChatGPTSignInButton id="csp-react" />
      <ChatGPTSignInButton id="csp-react-secondary" />
      <ChatGPTProfilePicture size={size} alt="CSP account" />
    </ChatGPTAuthProvider>
  );
}
const host = document.getElementById('csp-dom')!;
createChatGPTAuth({ adapter: adapter('dom') }).mountSignInButton(host, { stylesheet: 'external' });
const shadow = document.getElementById('csp-shadow')!.attachShadow({ mode: 'open' });
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '/packages/core/dist/styles.css';
const slot = document.createElement('div');
shadow.append(link, slot);
createChatGPTAuth({ authPath: '/auth/start' }).mountSignInButton(slot, { stylesheet: 'external' });
hydrateRoot(document.getElementById('csp-react-root')!, <Fixture />, {
  onRecoverableError: (error) => state.hydrationErrors.push(String(error)),
});
declare global {
  interface Window {
    cspFixture: {
      state: typeof state;
      resize(size: number): void;
      complete(kind: 'dom' | 'react'): void;
    };
    cspViolations: string[];
  }
}
window.cspFixture = {
  state,
  resize: (size) => resize(size),
  complete: (kind) => resolvers.get(kind)?.({ status: 'complete' }),
};
