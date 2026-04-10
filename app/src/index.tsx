import React, {useEffect, useMemo, useState} from "react";
import {Box, Text, render, useApp, useInput} from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import {
  buildConfig,
  cloneConfig,
  createPresetBackup,
  createPresetFromBase,
  loadPresetBackup,
  listPresets,
  listPresetBackups,
  loadBaseConfig,
  parseImportedMods,
  savePreset,
  writeRuntimeConfig
} from "./lib/config.js";
import {appendImportLog} from "./lib/logger.js";
import {detectExternalIp} from "./lib/network.js";
import {resolveServerRoot} from "./lib/paths.js";
import {launchServer} from "./lib/server.js";
import {getSettingsPath, loadSettings, saveSettings} from "./lib/settings.js";
import {checkModsAgainstImportedList, checkModsAgainstWorkshop} from "./lib/workshop.js";
import {ImportModsError, type AppSettings, type PresetBackup, type PresetFile, type ServerConfig, type ServerMod, type UpdateResult} from "./types.js";

type Step =
  | "loading"
  | "select-preset"
  | "create-preset-name"
  | "create-preset-base"
  | "configure-server-root"
  | "review"
  | "backup-select"
  | "server-name"
  | "ip-choice"
  | "ip-custom"
  | "scenario"
  | "mods-decision"
  | "mods-paste"
  | "mods-import-error"
  | "mods-check"
  | "mods-check-running"
  | "save-preset"
  | "saving"
  | "launch"
  | "launching"
  | "done"
  | "error";

interface AppState {
  step: Step;
  presets: PresetFile[];
  serverRoot?: string;
  baseConfig?: ServerConfig;
  settings: AppSettings;
  selectedPresetName?: string;
  currentConfig?: ServerConfig;
  presetBackups?: PresetBackup[];
  draftPresetName: string;
  detectedIp?: string;
  importedMods?: ServerMod[];
  updateResults: UpdateResult[];
  runtimeConfigPath?: string;
  settingsPath?: string;
  doneMessage?: string;
  canReturnToReview?: boolean;
  errorMessage?: string;
  importError?: ImportModsError;
}

function App() {
  const {exit} = useApp();
  const [state, setState] = useState<AppState>({
    step: "loading",
    presets: [],
    settings: {},
    draftPresetName: "",
    updateResults: []
  });
  const [textValue, setTextValue] = useState("");
  const [pasteValue, setPasteValue] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [settings, baseConfig] = await Promise.all([loadSettings(), loadBaseConfig()]);
        const settingsPath = getSettingsPath();
        const serverRoot = await resolveServerRoot(settings.serverRoot).catch(() => undefined);
        const presets = serverRoot ? await listPresets(serverRoot) : [];
        const detectedIp = await detectExternalIp().catch(() => undefined);

        setState((current) => ({
          ...current,
          step: serverRoot ? "select-preset" : "configure-server-root",
          presets,
          serverRoot,
          baseConfig,
          settings,
          settingsPath,
          detectedIp
        }));
      } catch (error) {
        setError(error);
      }
    })();
  }, []);

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }

    if (state.step === "done" && key.return) {
      if (state.canReturnToReview) {
        setState((current) => ({
          ...current,
          step: "review",
          doneMessage: undefined,
          canReturnToReview: false
        }));
        return;
      }

      exit();
    }
  });

  const presetItems = useMemo(
    () => [
      ...state.presets.map((preset) => ({
        label: `${preset.name}  (${preset.config.game.scenarioId ?? "sem scenarioId"})`,
        value: preset.name
      })),
      {label: "Criar novo preset", value: "__create__"}
    ],
    [state.presets]
  );

  const currentConfig = state.currentConfig;

  function setError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setState((current) => ({
      ...current,
      step: "error",
      errorMessage: message
    }));
  }

  async function handleImportError(error: unknown, rawInput: string) {
    if (error instanceof ImportModsError) {
      const logPath = await appendImportLog({
        type: "import-mods-error",
        ...error.diagnostics,
        rawPreviewLength: rawInput.length,
        stack: error.stack
      });

      error.logPath = logPath;
      error.diagnostics.logPath = logPath;

      setState((current) => ({
        ...current,
        step: "mods-import-error",
        importError: error
      }));
      return;
    }

    setError(error);
  }

  async function persistAndWriteRuntimeConfig(config: ServerConfig): Promise<string> {
    if (!state.serverRoot) {
      throw new Error("Pasta do servidor nao configurada.");
    }

    const runtimeConfigPath = await writeRuntimeConfig(state.serverRoot, config);
    setState((current) => ({
      ...current,
      runtimeConfigPath
    }));
    return runtimeConfigPath;
  }

  function updateConfig(mutator: (config: ServerConfig) => void) {
    setState((current) => {
      if (!current.currentConfig) {
        return current;
      }

      const nextConfig = cloneConfig(current.currentConfig);
      mutator(nextConfig);

      return {
        ...current,
        currentConfig: nextConfig
      };
    });
  }

  if (state.step === "loading") {
    return <LoadingScreen label="Carregando presets e detectando IP externo" />;
  }

  if (state.step === "error") {
    return (
      <Frame title="Erro">
        <Text color="red">{state.errorMessage}</Text>
        <Text dimColor>Pressione Esc para sair.</Text>
      </Frame>
    );
  }

  if (state.step === "configure-server-root") {
    return (
      <Frame title="Pasta do Servidor">
        <Text>O app nao encontrou automaticamente o `ArmaReforgerServer.exe`.</Text>
        <Text>Digite a pasta onde esse executavel esta instalado.</Text>
        <SummaryLine label="settings.json" value={state.settingsPath ?? "nao definido"} />
        <Box marginTop={1}>
          <Text color="cyan">Pasta: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              void (async () => {
                try {
                  const manualRoot = value.trim();
                  if (!manualRoot) {
                    throw new Error("Pasta do servidor invalida.");
                  }

                  const serverRoot = await resolveServerRoot(manualRoot);
                  const settings = {...state.settings, serverRoot};
                  await saveSettings(settings);
                  const presets = await listPresets(serverRoot);

                  setState((current) => ({
                    ...current,
                    step: "select-preset",
                    serverRoot,
                    settings,
                    presets
                  }));
                  setTextValue("");
                } catch (error) {
                  setError(error);
                }
              })();
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "select-preset") {
    return (
      <Frame title="Preset">
        <SummaryLine label="IP externo detectado" value={state.detectedIp ?? "nao disponivel"} />
        <SummaryLine label="Pasta do servidor" value={state.serverRoot ?? "nao encontrada"} />
        <Text>Escolha um preset existente ou crie um novo.</Text>
        <SelectInput
          items={presetItems}
          onSelect={(item) => {
            setTextValue("");

            if (item.value === "__create__") {
              setState((current) => ({
                ...current,
                step: "create-preset-name"
              }));
              return;
            }

            const preset = state.presets.find((entry) => entry.name === item.value);
            if (!preset) {
              setError(new Error("Preset nao encontrado."));
              return;
            }

            setState((current) => ({
              ...current,
              step: "review",
              selectedPresetName: preset.name,
              currentConfig: cloneConfig(preset.config),
              importedMods: undefined,
              updateResults: []
            }));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "create-preset-name") {
    return (
      <Frame title="Novo Preset">
        <Text>Digite o nome do novo preset. O arquivo sera salvo como `nome.json`.</Text>
        <Box marginTop={1}>
          <Text color="cyan">Nome: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const normalized = normalizePresetName(value);
              if (!normalized) {
                setError(new Error("Nome de preset invalido."));
                return;
              }

              setState((current) => ({
                ...current,
                step: "create-preset-base",
                draftPresetName: normalized
              }));
              setTextValue("");
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "create-preset-base") {
    const baseItems = [
      {label: "Base padrao do app", value: "__base__"},
      ...state.presets.map((preset) => ({label: `Clonar ${preset.name}`, value: preset.name}))
    ];

    return (
      <Frame title="Origem">
        <Text>Escolha de onde o novo preset vai partir.</Text>
        <SelectInput
          items={baseItems}
          onSelect={(item) => {
            if (item.value === "__base__") {
              if (!state.baseConfig) {
                setError(new Error("Base padrao indisponivel."));
                return;
              }

              const config = createPresetFromBase(state.baseConfig, state.draftPresetName);
              setState((current) => ({
                ...current,
                step: "review",
                selectedPresetName: current.draftPresetName,
                currentConfig: config,
                importedMods: undefined,
                updateResults: []
              }));
              return;
            }

            const preset = state.presets.find((entry) => entry.name === item.value);
            if (!preset) {
              setError(new Error("Preset base nao encontrado."));
              return;
            }

            const config = cloneConfig(preset.config);
            config.game.name = state.draftPresetName;

            setState((current) => ({
              ...current,
              step: "review",
              selectedPresetName: current.draftPresetName,
              currentConfig: config,
              importedMods: undefined,
              updateResults: []
            }));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (!currentConfig) {
    return (
      <Frame title="Erro">
        <Text color="red">Nenhum preset carregado.</Text>
      </Frame>
    );
  }

  if (state.step === "review") {
    return (
      <Frame title="Resumo">
        <SummaryLine label="Preset" value={state.selectedPresetName ?? "sem nome"} />
        <SummaryLine label="Nome do servidor" value={currentConfig.game.name ?? "sem nome"} />
        <SummaryLine label="IP publico" value={currentConfig.publicAddress ?? "nao definido"} />
        <SummaryLine label="Scenario" value={currentConfig.game.scenarioId ?? "nao definido"} />
        <SummaryLine label="Mods" value={String(currentConfig.game.mods.length)} />
        <Box marginTop={1} flexDirection="column">
          <Text>Escolha a proxima acao.</Text>
          <SelectInput
            items={[
              {label: "Iniciar servidor agora", value: "start-now"},
              {label: "Editar nome do servidor", value: "server-name"},
              {label: "Editar IP publico", value: "ip"},
              {label: "Editar scenarioId", value: "scenario"},
              {label: "Importar mods do Reforger", value: "mods"},
              {label: "Carregar backup do preset", value: "backup"},
              {label: "Checar atualizacao dos mods", value: "check"},
              {label: "Salvar preset e gerar server.json", value: "save"},
              {label: "Gerar server.json sem salvar preset", value: "runtime"}
            ]}
            onSelect={(item) => {
              if (item.value === "start-now") {
                setState((current) => ({...current, step: "launching"}));

                void (async () => {
                  try {
                    const mergedConfig = materializeConfig(state.baseConfig, currentConfig);
                    const runtimeConfigPath = await persistAndWriteRuntimeConfig(mergedConfig);
                    if (!state.serverRoot) {
                      throw new Error("Pasta do servidor nao configurada.");
                    }
                    await launchServer(state.serverRoot, runtimeConfigPath);
                    setState((current) => ({
                      ...current,
                      runtimeConfigPath,
                      step: "done",
                      doneMessage: "Servidor iniciado com o preset atual.",
                      canReturnToReview: false
                    }));
                  } catch (error) {
                    setError(error);
                  }
                })();
                return;
              }

              if (item.value === "ip") {
                setState((current) => ({...current, step: "ip-choice"}));
                return;
              }

              if (item.value === "server-name") {
                setTextValue(currentConfig.game.name ?? "");
                setState((current) => ({...current, step: "server-name"}));
                return;
              }

              if (item.value === "scenario") {
                setTextValue(currentConfig.game.scenarioId ?? "");
                setState((current) => ({...current, step: "scenario"}));
                return;
              }

              if (item.value === "mods") {
                setState((current) => ({...current, step: "mods-decision"}));
                return;
              }

              if (item.value === "backup") {
                void (async () => {
                  try {
                    if (!state.selectedPresetName) {
                      throw new Error("Selecione ou salve um preset antes de carregar backups.");
                    }

                    const presetBackups = await listPresetBackups(state.selectedPresetName);
                    setState((current) => ({
                      ...current,
                      step: "backup-select",
                      presetBackups
                    }));
                  } catch (error) {
                    setError(error);
                  }
                })();
                return;
              }

              if (item.value === "check") {
                setState((current) => ({...current, step: "mods-check"}));
                return;
              }

              if (item.value === "save") {
                setState((current) => ({...current, step: "save-preset"}));
                return;
              }

              void (async () => {
                try {
                  await persistAndWriteRuntimeConfig(materializeConfig(state.baseConfig, currentConfig));
                  setState((current) => ({...current, step: "launch"}));
                } catch (error) {
                  setError(error);
                }
              })();
            }}
          />
        </Box>
        {renderUpdateSummary(state.updateResults)}
        <Footer />
      </Frame>
    );
  }

  if (state.step === "ip-choice") {
    const current = currentConfig.publicAddress ?? "nao definido";

    return (
      <Frame title="IP Publico">
        <SummaryLine label="Atual" value={current} />
        <SummaryLine label="Detectado" value={state.detectedIp ?? "nao disponivel"} />
        <SelectInput
          items={[
            {label: `Manter ${current}`, value: "keep"},
            ...(state.detectedIp ? [{label: `Usar ${state.detectedIp}`, value: "detected"}] : []),
            {label: "Digitar manualmente", value: "custom"},
            {label: "Voltar", value: "back"}
          ]}
          onSelect={(item) => {
            if (item.value === "keep" || item.value === "back") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            if (item.value === "detected" && state.detectedIp) {
              updateConfig((config) => applyPublicIp(config, state.detectedIp!));
              setState((current) => ({...current, step: "review"}));
              return;
            }

            setTextValue(currentConfig.publicAddress ?? "");
            setState((current) => ({...current, step: "ip-custom"}));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "ip-custom") {
    return (
      <Frame title="IP Manual">
        <Text>Digite o IP publico para `publicAddress`, `a2s.address` e `rcon.address`.</Text>
        <Box marginTop={1}>
          <Text color="cyan">IP: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const ip = value.trim();
              if (!ip) {
                setError(new Error("IP invalido."));
                return;
              }

              updateConfig((config) => applyPublicIp(config, ip));
              setState((current) => ({...current, step: "review"}));
              setTextValue("");
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "server-name") {
    return (
      <Frame title="Nome do Servidor">
        <Text>Edite o nome exibido na lista de servidores do Reforger.</Text>
        <Box marginTop={1}>
          <Text color="cyan">Nome: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const nextName = value.trim();
              if (!nextName) {
                setError(new Error("Nome do servidor invalido."));
                return;
              }

              updateConfig((config) => {
                config.game.name = nextName;
              });
              setTextValue("");
              setState((current) => ({...current, step: "review"}));
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "scenario") {
    return (
      <Frame title="Scenario">
        <Text>Edite o `scenarioId` completo da missao.</Text>
        <Box marginTop={1}>
          <Text color="cyan">scenarioId: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              updateConfig((config) => {
                config.game.scenarioId = value.trim();
              });
              setTextValue("");
              setState((current) => ({...current, step: "review"}));
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mods-decision") {
    return (
      <Frame title="Mods">
        <SummaryLine label="Mods atuais" value={String(currentConfig.game.mods.length)} />
        <Text>Se voce colar uma lista exportada nova, ela substitui `game.mods` do preset atual.</Text>
        <SelectInput
          items={[
            {label: "Colar nova lista de mods", value: "paste"},
            {label: "Voltar sem alterar", value: "back"}
          ]}
          onSelect={(item) => {
            if (item.value === "back") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            setPasteValue("");
            setState((current) => ({...current, step: "mods-paste"}));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "backup-select") {
    const backupItems = [
      ...((state.presetBackups ?? []).map((backup) => ({
        label: backup.label,
        value: backup.path
      }))),
      {label: "Voltar", value: "__back__"}
    ];

    return (
      <Frame title="Backups do Preset">
        <SummaryLine label="Preset" value={state.selectedPresetName ?? "sem nome"} />
        {state.presetBackups?.length ? (
          <Text>Escolha um backup para carregar no preset atual.</Text>
        ) : (
          <Text>Nenhum backup encontrado para esse preset ainda.</Text>
        )}
        <SelectInput
          items={backupItems}
          onSelect={(item) => {
            if (item.value === "__back__") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            void (async () => {
              try {
                const backupConfig = await loadPresetBackup(item.value);
                setState((current) => ({
                  ...current,
                  step: "review",
                  currentConfig: backupConfig
                }));
              } catch (error) {
                setError(error);
              }
            })();
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mods-paste") {
    return (
      <Frame title="Colar Mods">
        <Text>Cole a lista exportada do Reforger. Aceita array JSON completo ou objetos separados por virgula.</Text>
        <Text dimColor>Ctrl+S confirma a colagem.</Text>
        <PasteEditor
          value={pasteValue}
          onChange={setPasteValue}
          onSubmit={() => {
            void (async () => {
              try {
                const importedMods = parseImportedMods(pasteValue);
                const diff = checkModsAgainstImportedList(currentConfig.game.mods, importedMods);

                if (state.selectedPresetName) {
                  const backupConfig = materializeConfig(state.baseConfig, currentConfig);
                  await createPresetBackup(state.selectedPresetName, backupConfig, "mods-import");
                }

                updateConfig((config) => {
                  config.game.mods = importedMods;
                });

                setState((current) => ({
                  ...current,
                  step: "review",
                  importedMods,
                  updateResults: diff
                }));
                setPasteValue("");
              } catch (error) {
                await handleImportError(error, pasteValue);
              }
            })();
          }}
        />
      </Frame>
    );
  }

  if (state.step === "mods-import-error") {
    const importError = state.importError;

    return (
      <Frame title="Erro ao Importar Mods">
        <Text color="red">{importError?.userMessage ?? "Falha ao importar mods."}</Text>
        <SummaryLine label="Etapa" value={importError?.stage ?? "desconhecida"} />
        <SummaryLine label="Detalhe tecnico" value={importError?.technicalMessage ?? "sem detalhe"} />
        <SummaryLine label="Caracteres" value={String(importError?.diagnostics.rawLength ?? 0)} />
        <SummaryLine label="Linhas" value={String(importError?.diagnostics.lineCount ?? 0)} />
        <SummaryLine label="Log" value={importError?.logPath ?? "nao gravado"} />
        <Text dimColor>Amostra:</Text>
        <Text dimColor>{importError?.sample ?? "sem amostra"}</Text>
        <SelectInput
          items={[
            {label: "Voltar para a colagem", value: "retry"},
            {label: "Voltar ao resumo", value: "review"}
          ]}
          onSelect={(item) => {
            if (item.value === "retry") {
              setState((current) => ({
                ...current,
                step: "mods-paste",
                importError: undefined
              }));
              return;
            }

            setState((current) => ({
              ...current,
              step: "review",
              importError: undefined
            }));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mods-check") {
    return (
      <Frame title="Atualizacao de Mods">
        <Text>Fonte preferencial: lista importada. Fallback: workshop web da Bohemia.</Text>
        <SelectInput
          items={[
            ...(state.importedMods ? [{label: "Comparar com a lista importada", value: "imported"}] : []),
            {label: "Consultar workshop", value: "workshop"},
            {label: "Voltar", value: "back"}
          ]}
          onSelect={(item) => {
            if (item.value === "back") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            if (item.value === "imported") {
              const importedMods = state.importedMods ?? [];
              const results = checkModsAgainstImportedList(currentConfig.game.mods, importedMods);
              setState((current) => ({
                ...current,
                step: "review",
                updateResults: results
              }));
              return;
            }

            setState((current) => ({...current, step: "mods-check-running"}));

            void (async () => {
              try {
                const results = await checkModsAgainstWorkshop(currentConfig.game.mods);
                setState((current) => ({
                  ...current,
                  step: "review",
                  updateResults: results
                }));
              } catch (error) {
                setError(error);
              }
            })();
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mods-check-running") {
    return <LoadingScreen label={`Consultando workshop para ${currentConfig.game.mods.length} mods`} />;
  }

  if (state.step === "save-preset") {
    return (
      <Frame title="Salvar">
        <Text>O preset selecionado sera salvo antes de gerar o `server.json`.</Text>
        <SelectInput
          items={[
            {label: `Salvar ${state.selectedPresetName ?? "preset"}.json`, value: "save"},
            {label: "Cancelar", value: "cancel"}
          ]}
          onSelect={(item) => {
            if (item.value === "cancel") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            setState((current) => ({...current, step: "saving"}));

            void (async () => {
              try {
                const mergedConfig = materializeConfig(state.baseConfig, currentConfig);
                if (!state.serverRoot) {
                  throw new Error("Pasta do servidor nao configurada.");
                }
                await savePreset(state.serverRoot, state.selectedPresetName ?? "preset", mergedConfig);
                await persistAndWriteRuntimeConfig(mergedConfig);
                const presets = await listPresets(state.serverRoot);
                setState((current) => ({
                  ...current,
                  presets,
                  step: "launch"
                }));
              } catch (error) {
                setError(error);
              }
            })();
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "saving") {
    return <LoadingScreen label="Salvando preset e gerando server.json" />;
  }

  if (state.step === "launch") {
    return (
      <Frame title="Abrir Servidor">
        <SummaryLine label="server.json" value={state.runtimeConfigPath ?? "nao gerado"} />
        <SelectInput
          items={[
            {label: "Abrir ArmaReforgerServer.exe agora", value: "launch"},
            {label: "Finalizar sem abrir", value: "finish"}
          ]}
          onSelect={(item) => {
            if (item.value === "finish") {
              setState((current) => ({
                ...current,
                step: "done",
                doneMessage: "server.json gerado com sucesso.",
                canReturnToReview: true
              }));
              return;
            }

            setState((current) => ({...current, step: "launching"}));

            void (async () => {
              try {
                if (!state.runtimeConfigPath) {
                  throw new Error("server.json ainda nao foi gerado.");
                }

                if (!state.serverRoot) {
                  throw new Error("Pasta do servidor nao configurada.");
                }

                await launchServer(state.serverRoot, state.runtimeConfigPath);
                setState((current) => ({
                  ...current,
                  step: "done",
                  doneMessage: "Servidor iniciado no terminal.",
                  canReturnToReview: false
                }));
              } catch (error) {
                setError(error);
              }
            })();
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "launching") {
    return <LoadingScreen label="Abrindo ArmaReforgerServer.exe" />;
  }

  return (
    <Frame title="Concluido">
      <Text color="green">{state.doneMessage ?? "Operacao finalizada."}</Text>
      {state.canReturnToReview ? (
        <SelectInput
          items={[
            {label: "Voltar ao resumo", value: "review"},
            {label: "Sair", value: "exit"}
          ]}
          onSelect={(item) => {
            if (item.value === "review") {
              setState((current) => ({
                ...current,
                step: "review",
                doneMessage: undefined,
                canReturnToReview: false
              }));
              return;
            }

            exit();
          }}
        />
      ) : (
        <Text dimColor>Pressione Enter ou Esc para sair.</Text>
      )}
    </Frame>
  );
}

function materializeConfig(baseConfig: ServerConfig | undefined, currentConfig: ServerConfig): ServerConfig {
  if (!baseConfig) {
    return currentConfig;
  }

  return buildConfig(baseConfig, currentConfig);
}

function applyPublicIp(config: ServerConfig, ip: string) {
  config.publicAddress = ip;
  config.a2s ??= {};
  config.a2s.address = ip;
  config.rcon ??= {};
  config.rcon.address = ip;
}

function normalizePresetName(value: string): string {
  return value.trim().replace(/\.json$/i, "");
}

function Frame(props: {title: string; children: React.ReactNode}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text color="magentaBright">FCAT Server Manager</Text>
      <Text color="cyanBright">{props.title}</Text>
      <Box marginTop={1} flexDirection="column">
        {props.children}
      </Box>
    </Box>
  );
}

function LoadingScreen(props: {label: string}) {
  return (
    <Frame title="Processando">
      <Text>
        <Text color="green">
          <Spinner type="dots" />
        </Text>{" "}
        {props.label}
      </Text>
    </Frame>
  );
}

function SummaryLine(props: {label: string; value: string}) {
  return (
    <Text>
      <Text color="yellow">{props.label}: </Text>
      {props.value}
    </Text>
  );
}

function Footer() {
  return <Text dimColor>Esc sai do app.</Text>;
}

function PasteEditor(props: {
  value: string;
  onChange: React.Dispatch<React.SetStateAction<string>>;
  onSubmit: () => void;
}) {
  useInput((input, key) => {
    if (key.ctrl && input === "s") {
      props.onSubmit();
      return;
    }

    if (key.return) {
      props.onChange((current) => `${current}\n`);
      return;
    }

    if (key.backspace || key.delete) {
      props.onChange((current) => current.slice(0, -1));
      return;
    }

    if (input) {
      props.onChange((current) => `${current}${input}`);
    }
  });

  const previewLines = props.value.split("\n");
  const visibleLines = previewLines.slice(-12);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
        {visibleLines.length === 0 ? (
          <Text dimColor>Cole o JSON aqui...</Text>
        ) : (
          visibleLines.map((line, index) => (
            <Text key={`${index}-${line}`}>{line || " "}</Text>
          ))
        )}
      </Box>
      <Text dimColor>{props.value.length} caracteres</Text>
    </Box>
  );
}

function renderUpdateSummary(results: UpdateResult[]) {
  if (!results.length) {
    return null;
  }

  const changed = results.filter((result) => result.changed);
  const unavailable = results.filter((result) => result.source === "unavailable");
  const preview = results.slice(0, 8);

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="magentaBright">Resumo de atualizacao</Text>
      <Text>{changed.length} mod(s) com versao diferente.</Text>
      {unavailable.length > 0 ? <Text>{unavailable.length} mod(s) sem resposta confiavel do workshop.</Text> : null}
      {preview.map((result) => (
        <Text key={result.modId} color={result.changed ? "green" : "white"}>
          {result.name}: {result.currentVersion}
          {result.remoteVersion ? ` -> ${result.remoteVersion}` : ""}
          {result.note ? ` (${result.note})` : ""}
        </Text>
      ))}
      {results.length > preview.length ? <Text dimColor>...e mais {results.length - preview.length} mod(s).</Text> : null}
    </Box>
  );
}

render(<App />);
