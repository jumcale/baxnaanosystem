declare module 'supertest' {
  import type { Application } from 'express';

  interface TestResponse {
    status: number;
    body: any;
    headers: Record<string, string>;
    text: string;
  }

  interface SuperTestRequest extends Promise<TestResponse> {
    send(body?: unknown): SuperTestRequest;
    set(field: string, val: string): SuperTestRequest;
  }

  interface SuperTestAgent {
    get(url: string): SuperTestRequest;
    post(url: string): SuperTestRequest;
    patch(url: string): SuperTestRequest;
    put(url: string): SuperTestRequest;
    delete(url: string): SuperTestRequest;
  }

  function request(app: Application | unknown): SuperTestAgent;
  export default request;
}

