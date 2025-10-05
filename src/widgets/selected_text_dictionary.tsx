import { usePlugin, renderWidget } from "@remnote/plugin-sdk";
import React, { useEffect, useState } from "react";

function DictionaryWidget() {
  const plugin = usePlugin();

  const [selectedWord, setSelectedWord] = useState<string>("");
  const [definition, setDefinition] = useState<string>("Selecione uma palavra para buscar.");
  const [synonyms, setSynonyms] = useState<string[]>([]);
  const [tab, setTab] = useState<"def" | "syn">("def");

  useEffect(() => {
    async function fetchData() {
      const rawSelected = await plugin.editor.getSelectedText();
      let selected = "";

      // Caso 1: retorno é string
      if (typeof rawSelected === "string" && rawSelected.trim() !== "") {
        selected = rawSelected.trim();
      }
      // Caso 2: retorno é objeto com richText
      else if (rawSelected && Array.isArray(rawSelected.richText)) {
        selected = rawSelected.richText.map((t: any) => t.text).join(" ").trim();
      }
      // Caso 3: fallback → pega o Rem em foco
      else {
        const rem = await plugin.rem.getFocusedRem();
        if (rem?.text) {
          selected = rem.text.map((t: any) => t.text).join(" ").trim();
        }
      }

      // 🔧 Expande a seleção para garantir palavra inteira
      if (selected) {
        const match = selected.match(/[A-Za-zÀ-ÿ]+/);
        if (match) {
          selected = match[0].toLowerCase();
        }
      }

      if (!selected) {
        setSelectedWord("");
        setDefinition("Nenhuma palavra selecionada.");
        setSynonyms([]);
        return;
      }

      setSelectedWord(selected);

      // --- Definição (Dicionário Aberto) ---
      try {
        const url = `https://api.dicionario-aberto.net/word/${encodeURIComponent(selected)}`;
        const res = await fetch(url);

        if (!res.ok) {
          setDefinition(`Erro ao buscar definição (HTTP ${res.status}).`);
          return;
        }

        const data = await res.json();

        if (Array.isArray(data) && data.length > 0 && typeof data[0]?.xml === "string") {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data[0].xml, "text/xml");

          const defs = Array.from(xmlDoc.getElementsByTagName("def"))
            .map((node) => node.textContent?.trim())
            .filter((t): t is string => Boolean(t));

          if (defs.length > 0) {
            const cleaned = defs.map((d) =>
              d
                .replace(/_/g, "")
                .replace(/\s*\r?\n\s*/g, " ")
                .replace(/\s{2,}/g, " ")
                .trim()
            );
            setDefinition(cleaned.join("||"));
          } else {
            setDefinition("Nenhuma definição encontrada.");
          }
        } else {
          setDefinition("Nenhuma definição encontrada.");
        }
      } catch (e) {
        setDefinition("Erro de conexão ao buscar definição.");
      }

      // --- Sinônimos (placeholder por enquanto) ---
      setSynonyms(["(Integração de sinônimos ainda não implementada)"]);
    }

    fetchData();
  }, [plugin]);

  return (
    <div style={{ padding: "12px", maxWidth: 500 }}>
      {selectedWord && (
        <h3 style={{ marginTop: 0, marginBottom: "12px" }}>
          {selectedWord.charAt(0).toUpperCase() + selectedWord.slice(1)}
        </h3>
      )}

      <div style={{ marginBottom: "12px", display: "flex", gap: "8px" }}>
        <button onClick={() => setTab("def")}>📖 Definições</button>
        <button onClick={() => setTab("syn")}>🔄 Sinônimos</button>
      </div>

      {definition && (
        <div style={{ marginBottom: "8px", color: "#666" }}>{definition.includes("||") ? "" : definition}</div>
      )}

      {selectedWord && (
        <div style={{ marginBottom: "12px" }}>
          <a
            href={`https://www.dicio.com.br/${encodeURIComponent(selectedWord)}/`}
            target="_blank"
            rel="noopener noreferrer"
          >
            🔎 Ver no Dicio.com.br
          </a>
        </div>
      )}

      {tab === "def" && definition.includes("||") && (
        <ul style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.6 }}>
          {definition.split("||").map((def, i) => (
            <li key={i}>
              <span
                dangerouslySetInnerHTML={{
                  __html: def.replace(/_([^_]+)_/g, "<i>$1</i>"),
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {tab === "syn" && (
        <ul style={{ margin: 0, paddingLeft: "20px" }}>
          {synonyms.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

renderWidget(DictionaryWidget);
