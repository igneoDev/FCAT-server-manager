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
  removeServerMod,
  savePreset,
  sortServerMods,
  upsertServerMod,
  writeRuntimeConfig
} from "./lib/config.js";
import {appendImportLog} from "./lib/logger.js";
import {detectExternalIp} from "./lib/network.js";
import {resolveServerRoot} from "./lib/paths.js";
import {getServerProcessInfo, isTrackedServerRunning, launchServer, stopServerProcess} from "./lib/server.js";
import {getSettingsPath, loadSettings, saveSettings} from "./lib/settings.js";
import {checkModsAgainstImportedList, checkModsAgainstWorkshop, fetchWorkshopModById} from "./lib/workshop.js";
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
  | "mod-remove-filter"
  | "mod-remove-select"
  | "mod-add-id"
  | "mod-add-fetching"
  | "mod-add-name"
  | "mod-add-version"
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
  serverRunning?: boolean;
  serverPid?: number;
  importedMods?: ServerMod[];
  modRemoveFilter: string;
  draftMod: ServerMod;
  updateResults: UpdateResult[];
  runtimeConfigPath?: string;
  settingsPath?: string;
  doneMessage?: string;
  canReturnToReview?: boolean;
  errorMessage?: string;
  importError?: ImportModsError;
}

interface MenuItem {
  label: string;
  value: string;
  tone?: "warning";
  group?: "server" | "config" | "mods";
}

function App() {
  const {exit} = useApp();
  const [state, setState] = useState<AppState>({
    step: "loading",
    presets: [],
    settings: {},
    draftPresetName: "",
    modRemoveFilter: "",
    draftMod: {modId: "", name: "", version: ""},
    updateResults: []
  });
  const [textValue, setTextValue] = useState("");
  const [pasteValue, setPasteValue] = useState("");
  sharedHeaderState = state;

  useEffect(() => {
    void (async () => {
      try {
        const [settings, baseConfig] = await Promise.all([loadSettings(), loadBaseConfig()]);
        const settingsPath = getSettingsPath();
        const serverRoot = await resolveServerRoot(settings.serverRoot).catch(() => undefined);
        const presets = serverRoot ? await listPresets(serverRoot) : [];
        const detectedIp = await detectExternalIp().catch(() => undefined);
        const serverRunning = await isTrackedServerRunning().catch(() => false);
        const processInfo = await getServerProcessInfo().catch(() => null);

        setState((current) => ({
          ...current,
          step: serverRoot ? "select-preset" : "configure-server-root",
          presets,
          serverRoot,
          baseConfig,
          settings,
          settingsPath,
          detectedIp,
          serverRunning,
          serverPid: processInfo?.pid
        }));
      } catch (error) {
        setError(error);
      }
    })();
  }, []);

  useEffect(() => {
    if (state.step !== "mod-add-fetching") {
      return;
    }

    void (async () => {
      try {
        const mod = await fetchWorkshopModById(state.draftMod.modId);

        if (mod) {
          updateConfig((config) => {
            config.game.mods = upsertServerMod(config.game.mods, mod);
          });
          setState((current) => ({
            ...current,
            step: "done",
            doneMessage: `Mod ${mod.name} adicionado automaticamente a partir do workshop.`,
            canReturnToReview: true,
            draftMod: {modId: "", name: "", version: ""}
          }));
          return;
        }

        setState((current) => ({
          ...current,
          step: "mod-add-name"
        }));
      } catch {
        setState((current) => ({
          ...current,
          step: "mod-add-name"
        }));
      }
    })();
  }, [state.step, state.draftMod.modId]);

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }

    if (key.ctrl && input.toLowerCase() === "p" && state.currentConfig) {
      setState((current) => ({
        ...current,
        step: "select-preset",
        selectedPresetName: undefined,
        currentConfig: undefined,
        presetBackups: undefined,
        importedMods: undefined,
        updateResults: [],
        runtimeConfigPath: undefined,
        doneMessage: undefined,
        canReturnToReview: false
      }));
      return;
    }

    if (key.ctrl && input.toLowerCase() === "r" && state.currentConfig && state.step !== "review") {
      setState((current) => ({
        ...current,
        step: "review",
        doneMessage: undefined,
        canReturnToReview: false,
        importError: undefined
      }));
      return;
    }

    if (key.ctrl && input.toLowerCase() === "x" && state.serverRunning) {
      setState((current) => ({...current, step: "launching"}));

      void (async () => {
        try {
          const stopped = await stopServerProcess();
          setState((current) => ({
            ...current,
            step: "done",
            doneMessage: stopped
              ? `Servidor ${getPresetLabel(state.selectedPresetName)} encerrado.`
              : "Nao existe um servidor iniciado por este app em execucao.",
            canReturnToReview: true,
            serverRunning: false,
            serverPid: undefined
          }));
        } catch (error) {
          setError(error);
        }
      })();
      return;
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
  const reviewMenuItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [];

    items.push(
      {label: "Iniciar servidor agora", value: "start-now", group: "server"},
      {label: "Salvar preset", value: "save", group: "config"},
      {label: "Editar nome do servidor", value: "server-name", group: "config"},
      {label: "Editar IP publico", value: "ip", group: "config"},
      {label: "Editar missao (scenarioId)", value: "scenario", group: "config"},
      {label: "Importar mods do Reforger", value: "mods", group: "mods"},
      {label: "Adicionar um mod manualmente", value: "mod-add", group: "mods"},
      {label: "Remover um mod da lista atual", value: "mod-remove", group: "mods"},
      {label: "Verificar atualizacao dos mods", value: "check", group: "mods"},
      {label: "Restaurar backup do preset", value: "backup", group: "mods"}
    );

    return items;
  }, [state.serverRunning]);

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
      <Frame title="Escolher Preset">
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
      <Frame title="Base do Novo Preset">
        <Text>Escolha a configuracao inicial do novo preset.</Text>
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
        <Box marginTop={1} flexDirection="column">
          <Text>O que voce quer fazer agora?</Text>
          <ReviewActionMenu
            items={reviewMenuItems}
            onSelect={(item) => {
              if (item.value === "start-now") {
                setState((current) => ({...current, step: "launching"}));

                void (async () => {
                  try {
                    if (!state.serverRoot) {
                      throw new Error("Pasta do servidor nao configurada.");
                    }

                    const mergedConfig = materializeConfig(state.baseConfig, currentConfig);
                    const runtimeConfigPath = await persistAndWriteRuntimeConfig(mergedConfig);
                    const processInfo = await launchServer(state.serverRoot, runtimeConfigPath);
                    setState((current) => ({
                      ...current,
                      runtimeConfigPath,
                      step: "done",
                      doneMessage: `Servidor ${getPresetLabel(state.selectedPresetName)} iniciado.`,
                      canReturnToReview: true,
                      serverRunning: true,
                      serverPid: processInfo.pid
                    }));
                  } catch (error) {
                    setError(error);
                  }
                })();
                return;
              }

              if (item.value === "stop-server") {
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

              if (item.value === "mod-add") {
                setTextValue("");
                setState((current) => ({
                  ...current,
                  step: "mod-add-id",
                  draftMod: {modId: "", name: "", version: ""}
                }));
                return;
              }

              if (item.value === "mod-remove") {
                setTextValue("");
                setState((current) => ({
                  ...current,
                  step: "mod-remove-filter",
                  modRemoveFilter: ""
                }));
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
        <Text>Digite o IP publico que sera usado pelo servidor, A2S e RCON.</Text>
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
      <Frame title="Missao">
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
        <Text>Escolha como deseja alterar a lista de mods deste preset.</Text>
        <SelectInput
          items={[
            {label: "Importar lista completa do Reforger", value: "paste"},
            {label: "Adicionar um mod manualmente", value: "add"},
            {label: "Remover um mod da lista atual", value: "remove"},
            {label: "Voltar sem alterar", value: "back"}
          ]}
          onSelect={(item) => {
            if (item.value === "back") {
              setState((current) => ({...current, step: "review"}));
              return;
            }

            if (item.value === "add") {
              setTextValue("");
              setState((current) => ({
                ...current,
                step: "mod-add-id",
                draftMod: {modId: "", name: "", version: ""}
              }));
              return;
            }

            if (item.value === "remove") {
              setState((current) => ({...current, step: "mod-remove-select"}));
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

  if (state.step === "mod-remove-select") {
    const filter = state.modRemoveFilter.trim().toLowerCase();
    const filteredMods = currentConfig.game.mods.filter((mod) => {
      if (!filter) {
        return true;
      }

      return (
        mod.name.toLowerCase().includes(filter) ||
        mod.modId.toLowerCase().includes(filter)
      );
    });

    const modItems = [
      ...filteredMods.map((mod) => ({
        label: `${mod.name} (${mod.version})`,
        value: mod.modId
      })),
      {label: "Voltar", value: "__back__"}
    ];

    return (
      <Frame title="Remover Mod">
        <SummaryLine
          label="Filtro"
          value={state.modRemoveFilter || "sem filtro"}
        />
        <SummaryLine
          label="Resultados"
          value={`${filteredMods.length} de ${currentConfig.game.mods.length}`}
        />
        <Text>Escolha o mod que deseja remover da lista atual.</Text>
        <SelectInput
          items={modItems}
          limit={18}
          onSelect={(item) => {
            if (item.value === "__back__") {
              setState((current) => ({...current, step: "mod-remove-filter"}));
              return;
            }

            updateConfig((config) => {
              config.game.mods = removeServerMod(config.game.mods, item.value);
            });
            setState((current) => ({
              ...current,
              step: "done",
              doneMessage: `Mod removido com sucesso do preset ${getPresetLabel(state.selectedPresetName)}.`,
              canReturnToReview: true,
              modRemoveFilter: ""
            }));
          }}
        />
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mod-remove-filter") {
    return (
      <Frame title="Remover Mod">
        <Text>Digite parte do nome ou o `modId` do mod que deseja encontrar.</Text>
        <Text dimColor>Deixe vazio para listar todos os mods.</Text>
        <Box marginTop={1}>
          <Text color="cyan">Filtro: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              setState((current) => ({
                ...current,
                step: "mod-remove-select",
                modRemoveFilter: value.trim()
              }));
              setTextValue("");
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mod-add-id") {
    return (
      <Frame title="Adicionar Mod">
        <Text>Digite o `modId` do mod.</Text>
        <Box marginTop={1}>
          <Text color="cyan">modId: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const modId = value.trim();
              if (!modId) {
                setError(new Error("modId invalido."));
                return;
              }

              setState((current) => ({
                ...current,
                step: "mod-add-fetching",
                draftMod: {...current.draftMod, modId}
              }));
              setTextValue("");
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mod-add-fetching") {
    return <LoadingScreen label={`Buscando mod ${state.draftMod.modId} no workshop`} />;
  }

  if (state.step === "mod-add-name") {
    return (
      <Frame title="Adicionar Mod">
        <Text>Nao foi possivel preencher automaticamente. Digite o nome do mod.</Text>
        <Box marginTop={1}>
          <Text color="cyan">Nome: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const name = value.trim();
              if (!name) {
                setError(new Error("Nome do mod invalido."));
                return;
              }

              setState((current) => ({
                ...current,
                step: "mod-add-version",
                draftMod: {...current.draftMod, name}
              }));
              setTextValue("");
            }}
          />
        </Box>
        <Footer />
      </Frame>
    );
  }

  if (state.step === "mod-add-version") {
    return (
      <Frame title="Adicionar Mod">
        <Text>Digite a versao do mod.</Text>
        <Box marginTop={1}>
          <Text color="cyan">Versao: </Text>
          <TextInput
            value={textValue}
            onChange={setTextValue}
            onSubmit={(value) => {
              const version = value.trim();
              if (!version) {
                setError(new Error("Versao do mod invalida."));
                return;
              }

              try {
                const modToAdd = {...state.draftMod, version};
                updateConfig((config) => {
                  config.game.mods = upsertServerMod(config.game.mods, modToAdd);
                });
                setState((current) => ({
                  ...current,
                  step: "review",
                  draftMod: {modId: "", name: "", version: ""}
                }));
                setTextValue("");
              } catch (error) {
                setError(error);
              }
            }}
          />
        </Box>
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
          <Text>Escolha um backup para restaurar neste preset.</Text>
        ) : (
          <Text>Ainda nao existe backup salvo para este preset.</Text>
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
      <Frame title="Importar Mods do Reforger">
        <Text>Cole a lista exportada do Reforger. Aceita um array JSON completo ou objetos separados por virgula.</Text>
        <Text dimColor>Use Ctrl+S para confirmar a importacao.</Text>
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
        <Text color="red">{importError?.userMessage ?? "Nao foi possivel importar os mods."}</Text>
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
        <Text>Voce pode comparar com a ultima lista importada ou consultar o workshop da Bohemia.</Text>
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
      <Frame title="Salvar Preset">
        <Text>O preset atual sera salvo no arquivo correspondente.</Text>
        <SelectInput
          items={[
            {label: `Salvar ${state.selectedPresetName ?? "preset"}.json`, value: "save"},
            {label: "Voltar", value: "cancel"}
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
                const runtimeConfigPath = await persistAndWriteRuntimeConfig(mergedConfig);
                const presets = await listPresets(state.serverRoot);
                setState((current) => ({
                  ...current,
                  presets,
                  runtimeConfigPath,
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
    return <LoadingScreen label="Salvando o preset" />;
  }

  if (state.step === "launch") {
    return (
      <Frame title="Preset Salvo">
        <Text>O preset foi salvo e a configuracao do servidor foi atualizada.</Text>
        <SummaryLine label="Arquivo gerado" value={state.runtimeConfigPath ?? "nao gerado"} />
        <SelectInput
          items={[
            {label: "Abrir servidor agora", value: "launch"},
            {label: "Voltar sem abrir", value: "finish"}
          ]}
          onSelect={(item) => {
            if (item.value === "finish") {
              setState((current) => ({
                ...current,
                step: "done",
                doneMessage: `Preset ${getPresetLabel(state.selectedPresetName)} salvo com sucesso.`,
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

                const processInfo = await launchServer(state.serverRoot, state.runtimeConfigPath);
                setState((current) => ({
                  ...current,
                  step: "done",
                  doneMessage: `Servidor ${getPresetLabel(state.selectedPresetName)} iniciado.`,
                  canReturnToReview: true,
                  serverRunning: true,
                  serverPid: processInfo.pid
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
            {label: "Voltar para a lista de presets", value: "presets"},
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

            if (item.value === "presets") {
              setState((current) => ({
                ...current,
                step: "select-preset",
                selectedPresetName: undefined,
                currentConfig: undefined,
                presetBackups: undefined,
                importedMods: undefined,
                updateResults: [],
                runtimeConfigPath: undefined,
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

function getPresetLabel(value?: string): string {
  return value?.trim() || "selecionado";
}

let sharedHeaderState: Partial<AppState> = {};

function Frame(props: {title: string; children: React.ReactNode}) {
  const summaryLines = getHeaderSummary(sharedHeaderState);
  const globalActions = getGlobalActions(sharedHeaderState);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text color="magentaBright">FCAT Server Manager</Text>
      <Text color="cyanBright">{props.title}</Text>
      {summaryLines ? (
        <Box marginTop={1} flexDirection="column">
          {summaryLines.map((line) => (
            <Text key={line} dimColor>
              {line}
            </Text>
          ))}
        </Box>
      ) : null}
      {globalActions.length ? (
        <Box marginTop={1}>
          <Text>
            {globalActions.map((action, index) => (
              <Text key={action.label}>
                {index > 0 ? "  " : ""}
                <Text color={action.color}>{action.label}</Text>
              </Text>
            ))}
          </Text>
        </Box>
      ) : null}
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

function ReviewActionMenu(props: {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (props.items.length === 0) {
        return 0;
      }

      return Math.min(current, props.items.length - 1);
    });
  }, [props.items]);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setSelectedIndex((current) =>
        current <= 0 ? props.items.length - 1 : current - 1
      );
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((current) =>
        current >= props.items.length - 1 ? 0 : current + 1
      );
      return;
    }

    if (/^[1-9]$/.test(input)) {
      const targetIndex = Number.parseInt(input, 10) - 1;
      if (targetIndex >= 0 && targetIndex < props.items.length) {
        props.onSelect(props.items[targetIndex]);
      }
      return;
    }

    if (key.return && props.items[selectedIndex]) {
      props.onSelect(props.items[selectedIndex]);
    }
  });

  return (
    <Box marginTop={1} flexDirection="column">
      <ReviewActionGroup
        title="[SERVIDOR]"
        group="server"
        items={props.items}
        selectedIndex={selectedIndex}
      />
      <ReviewActionGroup
        title="[CONFIGURACAO]"
        group="config"
        items={props.items}
        selectedIndex={selectedIndex}
      />
      <ReviewActionGroup
        title="[MODS]"
        group="mods"
        items={props.items}
        selectedIndex={selectedIndex}
      />
    </Box>
  );
}

function ReviewActionGroup(props: {
  title: string;
  group: NonNullable<MenuItem["group"]>;
  items: MenuItem[];
  selectedIndex: number;
}) {
  const groupedItems = props.items
    .map((item, index) => ({item, index}))
    .filter((entry) => entry.item.group === props.group);

  if (groupedItems.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="magentaBright">{props.title}</Text>
      {groupedItems.map(({item, index}) => (
        <Text key={item.value} color={index === props.selectedIndex ? "cyan" : undefined}>
          {index === props.selectedIndex ? "> " : "  "}
          {item.label}
        </Text>
      ))}
    </Box>
  );
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

function getHeaderSummary(state: Partial<AppState>): string[] | null {
  if (!state.currentConfig) {
    return null;
  }

  const config = state.currentConfig;

  return [
    `Preset: ${state.selectedPresetName ?? "sem nome"} | Status: ${state.serverRunning ? `RODANDO (PID ${state.serverPid ?? "?"})` : "PARADO"}`,
    `Servidor: ${config.game.name ?? "sem nome"}`,
    `IP: ${config.publicAddress ?? "nao definido"} | Missao: ${config.game.scenarioId ?? "nao definida"} | Mods: ${config.game.mods.length}`
  ];
}

function getGlobalActions(state: Partial<AppState>): Array<{label: string; color?: string}> {
  const actions: Array<{label: string; color?: string}> = [];

  if (state.currentConfig) {
    actions.push({label: "[Ctrl+P] Trocar preset", color: "cyan"});
    actions.push({label: "[Ctrl+R] Voltar ao resumo", color: "cyan"});
  }

  if (state.serverRunning) {
    actions.push({label: "[Ctrl+X] Encerrar servidor", color: "yellow"});
  }

  return actions;
}

render(<App />);
