export const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const response = await fetch(baseUrl + url, {
    ...options,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') ?? '';
  const hasBody = ![204, 205, 304].includes(response.status);
  const data = hasBody
    ? contentType.includes('application/json')
      ? await response.json()
      : await response.text()
    : null;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  } as T;
};
