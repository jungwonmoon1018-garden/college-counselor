import SwiftUI

/// Minimal grounded-chat surface. The backend handles input screening, crisis
/// detection, PII redaction, and BYOK routing — the client only sends the
/// turn history and renders the normalized text reply.
struct ChatView: View {
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var sending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            if messages.isEmpty {
                                Text("chat.empty").font(.callout)
                                    .foregroundStyle(Theme.textMuted)
                                    .padding(.top, 40)
                            }
                            ForEach(messages) { msg in
                                bubble(msg).id(msg.id)
                            }
                            if sending { typingIndicator }
                        }
                        .padding(16)
                        .frame(maxWidth: 700)
                        .frame(maxWidth: .infinity)
                    }
                    .onChange(of: messages.count) { _ in
                        if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }

                if let error {
                    Text(error).font(.caption).foregroundStyle(Theme.red)
                        .padding(.horizontal, 16).padding(.bottom, 4)
                }

                composer
            }
            .background(Theme.bg)
            .navigationTitle("tab.chat")
        }
    }

    private func bubble(_ msg: ChatMessage) -> some View {
        let isUser = msg.role == "user"
        return HStack {
            if isUser { Spacer(minLength: 40) }
            Text(msg.content)
                .font(.callout)
                .foregroundStyle(isUser ? Color.white : Theme.textPrimary)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(isUser ? Theme.blue.opacity(0.8) : Theme.card)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.cardBorder, lineWidth: isUser ? 0 : 1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .textSelection(.enabled)
            if !isUser { Spacer(minLength: 40) }
        }
    }

    private var typingIndicator: some View {
        HStack { ProgressView().controlSize(.small); Spacer() }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField("chat.placeholder", text: $input, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...5)
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || sending)
        }
        .padding(12)
        .background(Theme.bg)
    }

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        input = ""
        error = nil
        messages.append(ChatMessage(role: "user", content: text))
        sending = true
        Task {
            defer { sending = false }
            do {
                let resp = try await APIClient.shared.chat(messages: messages, tier: "medium")
                if let err = resp.error?.message {
                    error = err
                } else {
                    let reply = resp.firstText
                    messages.append(ChatMessage(role: "assistant", content: reply.isEmpty ? String(localized: "chat.no_reply") : reply))
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
