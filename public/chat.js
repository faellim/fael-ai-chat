
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");
const modelSelect = document.getElementById("model-select");
const modelInfo = document.getElementById("model-info");

const modelDescriptions = {
  llama: "Modelo de uso geral para perguntas, explicações e tarefas cotidianas.",
  glm: "Alternativa multilíngue com recursos de raciocínio e uso de ferramentas.",
  gemma: "Modelo multimodal para tarefas mais complexas, sujeito aos recursos suportados pelo chat."
};

let chatHistory = [];
let isProcessing = false;

modelSelect.addEventListener("change", () => {
  modelInfo.textContent =
    modelDescriptions[modelSelect.value] || modelDescriptions.llama;
});

userInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 180) + "px";
});

userInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

sendButton.addEventListener("click", sendMessage);

function addMessage(role, content) {
  const message = document.createElement("div");
  message.className = `message ${role}-message`;

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "user" ? "Você" : "Fael AI";

  const paragraph = document.createElement("p");
  paragraph.textContent = content;

  message.append(label, paragraph);
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return paragraph;
}

function extractText(json) {
  if (typeof json.response === "string") {
    return json.response;
  }

  const content = json.choices?.[0]?.delta?.content;

  if (typeof content === "string") {
    return content;
  }

  return "";
}

async function sendMessage() {
  const message = userInput.value.trim();

  if (!message || isProcessing) return;

  const selectedModel = modelSelect.value;

  isProcessing = true;
  userInput.disabled = true;
  sendButton.disabled = true;
  modelSelect.disabled = true;

  addMessage("user", message);
  userInput.value = "";
  userInput.style.height = "auto";

  chatHistory.push({ role: "user", content: message });

  typingIndicator.textContent =
    `Aguardando resposta de ${modelSelect.options[modelSelect.selectedIndex].text}...`;
  typingIndicator.classList.add("visible");

  let assistantTextEl = null;

  try {
    assistantTextEl = addMessage("assistant", "");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: chatHistory,
        model: selectedModel
      })
    });

    if (!response.ok) {
      let detail = "";

      try {
        const errorData = await response.json();
        detail = errorData.error || "";
      } catch {
        // A resposta de erro pode não ser JSON.
      }

      throw new Error(detail || `Erro HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("O servidor não retornou um fluxo de resposta.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let responseText = "";
    let finished = false;

    function processEvent(rawEvent) {
      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");

      if (!data) return;

      if (data === "[DONE]") {
        finished = true;
        return;
      }

      try {
        const json = JSON.parse(data);

        if (json.error) {
          throw new Error(json.error);
        }

        const text = extractText(json);

        if (text) {
          responseText += text;
          assistantTextEl.textContent = responseText;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message !== "Unexpected end of JSON input" &&
          !error.message.includes("JSON")
        ) {
          throw error;
        }

        console.warn("Evento SSE ignorado:", data);
      }
    }

    while (!finished) {
      const { value, done } = await reader.read();

      buffer += decoder.decode(value || new Uint8Array(), {
        stream: !done
      });
      buffer = buffer.replace(/\r/g, "");

      let boundary;

      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        processEvent(rawEvent);

        if (finished) break;
      }

      if (done) {
        if (buffer.trim() && !finished) {
          processEvent(buffer);
        }
        break;
      }
    }

    if (responseText) {
      chatHistory.push({
        role: "assistant",
        content: responseText
      });
    } else {
      assistantTextEl.textContent =
        "Não recebi texto nesta resposta. Tente novamente ou escolha outro modelo.";
    }
  } catch (error) {
    console.error("Erro no chat:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Erro desconhecido.";

    if (assistantTextEl) {
      assistantTextEl.textContent =
        `Não foi possível obter uma resposta: ${errorMessage}`;
    } else {
      addMessage("assistant", `Erro: ${errorMessage}`);
    }

    // Remove a mensagem do histórico se a solicitação falhou.
    if (chatHistory.at(-1)?.role === "user") {
      chatHistory.pop();
    }
  } finally {
    typingIndicator.classList.remove("visible");
    isProcessing = false;
    userInput.disabled = false;
    sendButton.disabled = false;
    modelSelect.disabled = false;
    userInput.focus();
  }
}
