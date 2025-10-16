import { usePlugin, renderWidget } from "@remnote/plugin-sdk";
import React, { useEffect, useState } from "react";

interface DefinitionEntry {
  category?: string;
  text: string;
}

interface SynonymCategory {
  category: string;
  synonyms: string[];
}

interface CacheEntry {
  definitions: DefinitionEntry[];
  synonyms: SynonymCategory[];
  timestamp: number;
}

const CACHE_DURATION = 1000 * 60 * 30; // 30 minutos
const cache = new Map<string, CacheEntry>();

function DictionaryWidget() {
  const plugin = usePlugin();

  const [selectedWord, setSelectedWord] = useState<string>("");
  const [definitions, setDefinitions] = useState<DefinitionEntry[]>([]);
  const [synonyms, setSynonyms] = useState<SynonymCategory[]>([]);
  const [tab, setTab] = useState<"def" | "syn">("def");
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingDefs, setLoadingDefs] = useState<boolean>(false);
  const [loadingSyns, setLoadingSyns] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Função para remover acentos
  function removeAccents(str: string): string {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  useEffect(() => {
    let timer: any;

    const fetchData = async () => {
      setLoading(true);
      setError("");
      
      const rawSelected = await plugin.editor.getSelectedText();
      let selected = "";

      // Caso 1: retorno é string
      if (typeof rawSelected === "string" && rawSelected.trim() !== "") {
        selected = rawSelected.trim();
      }
      // Caso 2: retorno é objeto com richText
      else if (rawSelected && Array.isArray((rawSelected as any).richText)) {
        selected = (rawSelected as any).richText.map((t: any) => t.text).join(" ").trim();
      }
      // Caso 3: fallback → pega o Rem em foco
      else {
        const rem = await plugin.rem.getFocusedRem();
        if (rem?.text) {
          selected = rem.text.map((t: any) => t.text).join(" ").trim();
        }
      }

      // Expande a seleção para garantir palavra inteira
      if (selected) {
        const match = selected.match(/[A-Za-zÀ-ÿ]+/);
        if (match) {
          selected = match[0].toLowerCase();
        }
      }

      if (!selected) {
        setSelectedWord("");
        setDefinitions([]);
        setSynonyms([]);
        setLoading(false);
        return;
      }

      setSelectedWord(selected);

      // Verifica cache
      const cached = cache.get(selected);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setDefinitions(cached.definitions);
        setSynonyms(cached.synonyms);
        setLoading(false);
        return;
      }

      setLoading(false);

      // Busca definições em background
      setLoadingDefs(true);
      fetchDefinitions(selected).then(defs => {
        setDefinitions(defs);
        setLoadingDefs(false);
        updateCache(selected, defs, null);
      }).catch(err => {
        console.error("Erro ao buscar definições:", err);
        setLoadingDefs(false);
      });

      // Busca sinônimos em background
      setLoadingSyns(true);
      fetchSynonyms(selected).then(syns => {
        setSynonyms(syns);
        setLoadingSyns(false);
        updateCache(selected, null, syns);
      }).catch(err => {
        console.error("Erro ao buscar sinônimos:", err);
        setLoadingSyns(false);
      });
    };

    // Debounce de 500ms
    timer = setTimeout(() => {
      fetchData();
    }, 500);

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [plugin]);

  function updateCache(word: string, defs: DefinitionEntry[] | null, syns: SynonymCategory[] | null) {
    const current = cache.get(word) || { definitions: [], synonyms: [], timestamp: Date.now() };
    cache.set(word, {
      definitions: defs !== null ? defs : current.definitions,
      synonyms: syns !== null ? syns : current.synonyms,
      timestamp: Date.now(),
    });
  }

  // Função para buscar definições do Dicio.com.br
  async function fetchDefinitions(word: string): Promise<DefinitionEntry[]> {
    console.log("📖 Buscando definições para:", word);
    
    // Estratégia 1: Tentar Dicio.com.br via proxy
    try {
      console.log("Tentando buscar do Dicio.com.br");
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
        `https://www.dicio.com.br/${removeAccents(word)}/`
      )}`;
      
      const res = await fetch(proxyUrl);
      
      if (res.ok) {
        const json = await res.json();
        const html = json.contents;
        console.log("HTML do Dicio recebido, tamanho:", html?.length || 0);
        
        const defs = extractDefinitionsFromDicio(html);
        
        if (defs.length > 0) {
          console.log("✅ Definições encontradas no Dicio:", defs.length);
          return defs;
        }
      }
    } catch (e) {
      console.log("❌ Erro ao buscar do Dicio:", e);
    }

    // Estratégia 2: Fallback para Dicionário Aberto (API)
    try {
      console.log("Tentando Dicionário Aberto como fallback");
      const url = `https://api.dicionario-aberto.net/word/${encodeURIComponent(word)}`;
      const res = await fetch(url);

      if (res.ok) {
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
            console.log("✅ Definições encontradas no Dicionário Aberto:", cleaned.length);
            return cleaned.map(text => ({ text }));
          }
        }
      }
    } catch (e) {
      console.log("❌ Erro no Dicionário Aberto:", e);
    }

    console.log("⚠️ Nenhuma definição encontrada");
    return [];
  }

  // Extração de definições do HTML do Dicio.com.br
  function extractDefinitionsFromDicio(html: string): DefinitionEntry[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    console.log("📄 Parseando HTML do Dicio, título:", doc.title);
    
    const definitions: DefinitionEntry[] = [];
    
    // Método 1: Buscar por .significado (estrutura principal do Dicio)
    const significadoDiv = doc.querySelector(".significado");
    if (significadoDiv) {
      console.log("Encontrada div .significado");
      
      // Pega a classe gramatical se existir
      const classGram = significadoDiv.querySelector(".cl, .adicional");
      const category = classGram?.textContent?.trim();
      
      // Busca por parágrafos e spans com definições
      const defElements = significadoDiv.querySelectorAll("p, span:not(.cl):not(.adicional)");
      
      defElements.forEach((el) => {
        const text = el.textContent?.trim();
        
        if (text && text.length > 15 && 
            !text.toLowerCase().includes("dicio") &&
            !text.includes("©") &&
            !text.includes("Significado de")) {
          
          // Remove numeração se existir (1., 2., etc)
          let cleanText = text.replace(/^\d+\.\s*/, "").trim();
          
          // Remove a categoria do texto se ela aparecer
          if (category && cleanText.includes(category)) {
            cleanText = cleanText.replace(category, "").trim();
          }
          
          if (cleanText.length > 10) {
            definitions.push({
              category: category || undefined,
              text: cleanText
            });
          }
        }
      });
    }

    if (definitions.length > 0) {
      console.log(`✅ Encontradas ${definitions.length} definições pelo método 1`);
      return definitions.slice(0, 10);
    }

    // Método 2: Buscar por parágrafos no conteúdo principal
    const paragraphs = doc.querySelectorAll("p");
    console.log(`Método 2: ${paragraphs.length} parágrafos encontrados`);
    
    paragraphs.forEach((p) => {
      if (p.closest("footer") || p.closest("nav") || p.closest("header")) return;
      
      const text = p.textContent?.trim();
      if (text && text.length > 20 && text.length < 400 && 
          !text.toLowerCase().includes("dicio") && 
          !text.includes("ferramenta") &&
          !text.includes("©") &&
          !text.includes("sinônimos")) {
        
        let cleanText = text.replace(/^\d+\.\s*/, "").trim();
        
        if (cleanText.length > 15) {
          definitions.push({ text: cleanText });
        }
      }
    });

    if (definitions.length > 0) {
      console.log(`✅ Encontradas ${definitions.length} definições pelo método 2`);
      return definitions.slice(0, 8);
    }

    console.log("❌ Nenhuma definição encontrada no HTML");
    return [];
  }

  // Função para buscar sinônimos com múltiplas estratégias
  async function fetchSynonyms(word: string): Promise<SynonymCategory[]> {
    console.log("🔍 Buscando sinônimos para:", word);
    
    // Estratégia 1: Usar API do Dicionário Aberto primeiro (mais confiável)
    try {
      console.log("Tentando Estratégia 1: Dicionário Aberto XML");
      const url = `https://api.dicionario-aberto.net/word/${encodeURIComponent(word)}`;
      const res = await fetch(url);

      if (res.ok) {
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0 && typeof data[0]?.xml === "string") {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(data[0].xml, "text/xml");

          const sinElements = xmlDoc.getElementsByTagName("sin");
          if (sinElements.length > 0) {
            const syns: string[] = [];
            Array.from(sinElements).forEach(el => {
              const text = el.textContent?.trim();
              if (text) syns.push(text);
            });
            if (syns.length > 0) {
              console.log("✅ Sinônimos encontrados no XML:", syns);
              return [{ category: "Sinônimos", synonyms: syns.slice(0, 20) }];
            }
          }
        }
      }
    } catch (e) {
      console.log("❌ Estratégia 1 falhou:", e);
    }

    // Estratégia 2: Tentar com AllOrigins
    try {
      console.log("Tentando Estratégia 2: AllOrigins");
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(
        `https://www.sinonimos.com.br/${removeAccents(word)}/`
      )}`;
      
      const res = await fetch(proxyUrl);
      
      if (res.ok) {
        const json = await res.json();
        const html = json.contents;
        console.log("HTML recebido, tamanho:", html?.length || 0);
        
        let syns = extractSynonymsWithCategories(html);
        
        if (syns.length > 0) {
          console.log("✅ Sinônimos encontrados via AllOrigins:", syns);
          return syns;
        }
      }
    } catch (e) {
      console.log("❌ Estratégia 2 falhou:", e);
    }

    console.log("⚠️ Nenhuma estratégia funcionou");
    return [];
  }

  // Extração de sinônimos com categorias
  function extractSynonymsWithCategories(html: string): SynonymCategory[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    console.log("📄 Parseando HTML para categorias, título:", doc.title);
    
    const categories: SynonymCategory[] = [];
    
    // Buscar por estrutura de categorias (h3/h4 seguido de lista)
    const headings = doc.querySelectorAll("h3, h4, .sentido");
    console.log(`Encontradas ${headings.length} possíveis categorias`);
    
    headings.forEach((heading) => {
      if (heading.closest("footer") || heading.closest("nav") || heading.closest("aside")) return;
      
      const categoryName = heading.textContent?.trim() || "";
      
      // Valida se é uma categoria válida
      if (!categoryName || categoryName.length < 2 || categoryName.length > 50) return;
      if (categoryName.toLowerCase().includes("ferramenta")) return;
      if (categoryName.toLowerCase().includes("popular")) return;
      if (categoryName.toLowerCase().includes("ia")) return;
      
      // Busca sinônimos após o heading
      const synonymsInCategory: string[] = [];
      let nextElement = heading.nextElementSibling;
      
      for (let i = 0; i < 3 && nextElement; i++) {
        if (nextElement.tagName === "H3" || nextElement.tagName === "H4") break;
        
        const links = nextElement.querySelectorAll("a");
        links.forEach(link => {
          const text = link.textContent?.trim();
          const href = link.getAttribute("href") || "";
          
          if (href.includes("/ferramenta") || href.includes("/tool")) return;
          if (!text || text.length < 3 || text.length > 25) return;
          
          if (isValidSynonymSimple(text) && !synonymsInCategory.includes(text)) {
            synonymsInCategory.push(text);
          }
        });
        
        nextElement = nextElement.nextElementSibling;
      }
      
      if (synonymsInCategory.length > 0) {
        console.log(`✅ Categoria "${categoryName}": ${synonymsInCategory.length} sinônimos`);
        categories.push({
          category: categoryName,
          synonyms: synonymsInCategory.slice(0, 15)
        });
      }
    });
    
    if (categories.length > 0) return categories;
    
    // Fallback: extração simples sem categorias
    console.log("Fallback: extraindo sinônimos sem categorias");
    const simpleSynonyms = extractSynonymsSimple(html);
    
    if (simpleSynonyms.length > 0) {
      return [{ category: "Sinônimos", synonyms: simpleSynonyms }];
    }
    
    return [];
  }

  function extractSynonymsSimple(html: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const synonyms: string[] = [];
    
    const mainContent = doc.querySelector("main, article, .content, #content");
    if (mainContent) {
      const links = mainContent.querySelectorAll("a");
      
      links.forEach((link) => {
        if (link.closest("footer") || link.closest("nav") || link.closest("header") || link.closest("aside")) return;
        
        const text = link.textContent?.trim();
        const href = link.getAttribute("href") || "";
        
        if (href.includes("/ferramenta") || href.includes("/tool") || href.includes("javascript:")) return;
        
        if (text && isValidSynonymSimple(text) && !synonyms.includes(text)) {
          synonyms.push(text);
        }
      });
    }
    
    return synonyms.slice(0, 20);
  }

  function isValidSynonymSimple(text: string): boolean {
    const lower = text.toLowerCase();
    
    const blacklist = [
      "sobre", "contato", "anunciar", "termos", "política",
      "reescrever", "corrigir", "resumir", "detector", "humanizador",
      "humanizar", "contador", "popular", "ferramenta", "dicio", 
      "sinonimos", "caracteres", "palavras", "grátis", "texto"
    ];
    
    if (blacklist.some(b => lower.includes(b))) return false;
    if (text.length < 3 || text.length > 25) return false;
    if (!/[a-záàâãéèêíïóôõöúçñ]/i.test(text)) return false;
    
    const words = text.split(/\s+/);
    if (words.length > 2) return false;
    if (words.some(w => ["de", "da", "do", "dos", "das"].includes(w.toLowerCase()))) return false;
    if (lower.endsWith("dor") || lower.endsWith("dora")) return false;
    
    return true;
  }

  return (
    <div style={{ 
      padding: "16px", 
      maxWidth: 500, 
      fontFamily: "system-ui, -apple-system, sans-serif",
      backgroundColor: "#fafafa",
      borderRadius: "8px",
      border: "1px solid #e0e0e0"
    }}>
      {selectedWord && (
        <h3 style={{ 
          marginTop: 0, 
          marginBottom: "16px",
          color: "#1a1a1a",
          fontSize: "1.5em",
          fontWeight: 600
        }}>
          {selectedWord.charAt(0).toUpperCase() + selectedWord.slice(1)}
        </h3>
      )}

      <div style={{ marginBottom: "16px", display: "flex", gap: "8px" }}>
        <button 
          onClick={() => setTab("def")}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: "6px",
            backgroundColor: tab === "def" ? "#4a90e2" : "#e0e0e0",
            color: tab === "def" ? "white" : "#666",
            cursor: "pointer",
            fontWeight: 500,
            transition: "all 0.2s"
          }}
        >
          📖 Definições
        </button>
        <button 
          onClick={() => setTab("syn")}
          style={{
            padding: "8px 16px",
            border: "none",
            borderRadius: "6px",
            backgroundColor: tab === "syn" ? "#4a90e2" : "#e0e0e0",
            color: tab === "syn" ? "white" : "#666",
            cursor: "pointer",
            fontWeight: 500,
            transition: "all 0.2s"
          }}
        >
          🔄 Sinônimos
        </button>
      </div>

      {loading && (
        <div style={{ 
          padding: "16px", 
          textAlign: "center", 
          color: "#666",
          fontSize: "0.95em"
        }}>
          ⏳ Carregando...
        </div>
      )}

      {error && (
        <div style={{ 
          padding: "12px", 
          backgroundColor: "#fee", 
          color: "#c33",
          borderRadius: "6px",
          marginBottom: "12px",
          fontSize: "0.9em"
        }}>
          ⚠️ {error}
        </div>
      )}

      {!loading && selectedWord && (
        <div style={{ marginBottom: "16px", display: "flex", gap: "12px" }}>
          <a
            href={`https://www.dicio.com.br/${removeAccents(selectedWord)}/`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#4a90e2",
              textDecoration: "none",
              fontSize: "0.9em",
              fontWeight: 500
            }}
          >
            🔎 Dicio.com.br
          </a>
          <a
            href={`https://www.sinonimos.com.br/${removeAccents(selectedWord)}/`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#4a90e2",
              textDecoration: "none",
              fontSize: "0.9em",
              fontWeight: 500
            }}
          >
            🔗 Sinônimos.com.br
          </a>
        </div>
      )}

      {!loading && tab === "def" && loadingDefs && definitions.length === 0 && (
        <div style={{ color: "#999", fontStyle: "italic", fontSize: "0.9em" }}>
          🔄 Buscando definições...
        </div>
      )}

      {!loading && tab === "def" && definitions.length > 0 && (
        <div>
          {definitions.map((def, i) => (
            <div key={i} style={{ marginBottom: "12px" }}>
              {def.category && (
                <span style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  backgroundColor: "#e8f4f8",
                  color: "#2c5f7c",
                  borderRadius: "4px",
                  fontSize: "0.75em",
                  fontWeight: 600,
                  marginRight: "8px",
                  marginBottom: "4px",
                  textTransform: "uppercase"
                }}>
                  {def.category}
                </span>
              )}
              <span style={{ color: "#333", lineHeight: 1.6 }}>
                {i + 1}. {def.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "syn" && loadingSyns && synonyms.length === 0 && (
        <div style={{ color: "#999", fontStyle: "italic", fontSize: "0.9em" }}>
          🔄 Buscando sinônimos...
        </div>
      )}

      {!loading && tab === "syn" && synonyms.length > 0 && (
        <div>
          {synonyms.map((category, catIndex) => (
            <div key={catIndex} style={{ marginBottom: "20px" }}>
              <h4 style={{ 
                margin: "0 0 12px 0",
                fontSize: "1.1em",
                fontWeight: 600,
                color: "#2c5f7c",
                borderBottom: "2px solid #e8f4f8",
                paddingBottom: "6px"
              }}>
                {category.category}
              </h4>
              <div style={{ 
                display: "flex", 
                flexWrap: "wrap", 
                gap: "8px",
                marginTop: "8px"
              }}>
                {category.synonyms.map((s, i) => (
                  <span
                    key={i}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#e8f4f8",
                      color: "#2c5f7c",
                      borderRadius: "16px",
                      fontSize: "0.9em",
                      fontWeight: 500
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !loadingSyns && tab === "syn" && synonyms.length === 0 && selectedWord && (
        <div style={{ 
          color: "#666", 
          fontStyle: "italic", 
          fontSize: "0.95em",
          padding: "12px",
          backgroundColor: "#f5f5f5",
          borderRadius: "6px"
        }}>
          Não foi possível buscar sinônimos no momento.
          <div style={{ marginTop: "8px", fontSize: "0.85em" }}>
            💡 Clique no link "Sinônimos.com.br" acima para ver diretamente no site.
          </div>
        </div>
      )}
    </div>
  );
}

renderWidget(DictionaryWidget);
