import json
import re
import sys

SERVER_FILES = [
    "oficial.json",
    "ct.json",
    "server.json",
    # "wwii.json",
]


# -----------------------------
#  PRIORIDADES (igual PowerShell)
# -----------------------------
def get_priority(name: str) -> int:
    rules = [
        (r"ACE ", 0),
        (r"RHS", 1),
        (r"GRS", 4),
        (r"Tactical[\s_]?Flava", 5),
        (r"FCAT", 6),
    ]

    for pattern, prio in rules:
        if re.search(pattern, name, flags=re.IGNORECASE):
            return prio

    return 3


# -----------------------------
#  CHAVE DE ORDENAÇÃO ESTÁVEL
# -----------------------------
def sort_key(mod):
    return (get_priority(mod["name"]), mod["name"].lower())


# -----------------------------
#  Lê lista colada pelo usuário
# -----------------------------
def read_mod_list():
    print("\nCole aqui a lista de mods exportada do Arma Reforger:")
    print("(Depois pressione CTRL+D em Linux/Mac ou CTRL+Z no Windows)\n")

    raw = sys.stdin.read().strip()

    try:
        mods = json.loads(f"[{raw}]")
        return mods
    except Exception as e:
        print("\n❌ Erro lendo JSON colado.\n")
        raise e


# -----------------------------
#  Atualiza os arquivos JSON
# -----------------------------
def update_server_files(mods):
    sorted_mods = sorted(mods, key=sort_key)

    for server_file in SERVER_FILES:
        try:
            with open(server_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            # valida estrutura mínima esperada
            if "game" not in data or "mods" not in data["game"]:
                print(f"⚠️ {server_file}: estrutura inválida (game.mods não encontrado)")
                continue

            data["game"]["mods"] = sorted_mods

            with open(server_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            print(f"✅ {server_file} atualizado com sucesso")

        except FileNotFoundError:
            print(f"⚠️ {server_file} não encontrado — ignorando")

        except json.JSONDecodeError:
            print(f"❌ {server_file} contém JSON inválido — ignorando")

        except Exception as e:
            print(f"❌ Erro inesperado em {server_file}: {e}")


# -----------------------------
#  MAIN
# -----------------------------
def main():
    mods = read_mod_list()
    update_server_files(mods)
    print("\n🎯 Processamento finalizado!\n")


if __name__ == "__main__":
    main()
