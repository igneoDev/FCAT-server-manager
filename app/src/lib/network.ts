export async function detectExternalIp(): Promise<string> {
  const response = await fetch("https://api.ipify.org?format=json");

  if (!response.ok) {
    throw new Error(`Falha ao detectar IP externo: ${response.status}`);
  }

  const payload = (await response.json()) as {ip?: string};

  if (!payload.ip) {
    throw new Error("Resposta de IP externo invalida.");
  }

  return payload.ip;
}
