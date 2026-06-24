<template>
    <div class="mb-5">
        <h5 class="mb-4">
            MegIA — Gestión de Versiones
        </h5>

        <!-- Version info -->
        <div class="card mb-4">
            <div class="card-body">
                <div class="d-flex align-items-center mb-2 flex-wrap gap-2">
                    <span class="text-muted me-1">Fork activo:</span>
                    <code class="small">MegIA-Devs/uptime-kuma @ {{ versionData.currentBranch || "megia-custom" }}</code>
                </div>
                <div class="d-flex align-items-center gap-3 flex-wrap">
                    <div>
                        <span class="text-muted small me-2">Versión actual:</span>
                        <span class="badge bg-primary">v{{ versionData.currentVersion || "..." }}</span>
                    </div>
                    <div v-if="versionData.currentCommit">
                        <span class="text-muted small me-2">Commit:</span>
                        <code class="small">{{ versionData.currentCommit }}</code>
                    </div>
                </div>

                <hr class="my-3" />

                <div v-if="!checked" class="text-muted small">
                    Haz clic en "Verificar" para comparar con upstream.
                </div>

                <template v-else-if="versionData.upstream">
                    <div class="d-flex align-items-center gap-3 flex-wrap mb-2">
                        <div>
                            <span class="text-muted small me-2">Upstream latest:</span>
                            <span class="badge" :class="versionData.hasUpdate ? 'bg-warning text-dark' : 'bg-success'">
                                {{ versionData.upstream.tag }}
                            </span>
                        </div>
                        <a :href="versionData.upstream.url" target="_blank" rel="noopener" class="small">
                            Ver changelog
                        </a>
                    </div>

                    <div v-if="versionData.hasUpdate" class="alert alert-warning p-2 small mb-0">
                        <strong>Actualización disponible</strong> — Hay cambios en
                        <code>louislam/uptime-kuma</code> que aún no están en tu fork.
                    </div>
                    <div v-else class="alert alert-success p-2 small mb-0">
                        Tu fork está al día con la última versión upstream.
                    </div>
                </template>

                <div v-else-if="checked" class="text-muted small">
                    No se pudo obtener información de la versión upstream.
                </div>
            </div>
        </div>

        <!-- Progress log -->
        <div v-if="progressLog.length > 0" class="mb-4">
            <div
                ref="logContainer"
                class="p-3 rounded"
                style="background: #1a1a2e; font-family: monospace; font-size: 12px; max-height: 220px; overflow-y: auto;"
            >
                <div
                    v-for="(entry, i) in progressLog"
                    :key="i"
                    class="mb-1"
                    :style="{ color: logColor(entry.status) }"
                >
                    <span class="me-2 opacity-75">{{ logIcon(entry.status) }}</span>
                    <span class="opacity-75 me-2">[{{ entry.step }}]</span>
                    {{ entry.message }}
                </div>
            </div>
        </div>

        <!-- Actions -->
        <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-outline-primary" :disabled="checking || updating" @click="checkVersion">
                <span v-if="checking" class="spinner-border spinner-border-sm me-1" role="status"></span>
                {{ checking ? "Verificando..." : "Verificar versión" }}
            </button>

            <button
                v-if="versionData.hasUpdate && !updating"
                class="btn btn-warning"
                :disabled="checking"
                @click="confirmUpdate"
            >
                Aplicar actualización upstream
            </button>

            <button v-if="updating" class="btn btn-warning" disabled>
                <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                Actualizando... no cerrar esta ventana
            </button>
        </div>

        <!-- Confirm modal -->
        <div v-if="showConfirm" class="modal d-block" tabindex="-1" style="background: rgba(0,0,0,0.6);">
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Confirmar actualización</h5>
                    </div>
                    <div class="modal-body">
                        <p>
                            Se integrará <strong>upstream/master</strong> de
                            <code>louislam/uptime-kuma {{ versionData.upstream && versionData.upstream.tag }}</code>
                            en la rama <code>megia-custom</code> de tu fork.
                        </p>
                        <ul class="small mb-0">
                            <li>Se hará <code>git fetch upstream</code> y <code>git merge upstream/master</code></li>
                            <li>Se ejecutará <code>npm ci</code> y <code>npm run build</code></li>
                            <li>El servidor se reiniciará automáticamente</li>
                            <li v-if="hasGithubToken">Los cambios se empujarán al fork en GitHub</li>
                            <li v-else class="text-warning">
                                No hay GITHUB_TOKEN configurado — los cambios no se empujarán al fork
                            </li>
                        </ul>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" @click="showConfirm = false">Cancelar</button>
                        <button class="btn btn-warning" @click="applyUpdate">Continuar</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            versionData: {
                currentVersion: null,
                currentCommit: null,
                currentBranch: null,
                upstream: null,
                hasUpdate: false,
            },
            checked: false,
            checking: false,
            updating: false,
            showConfirm: false,
            hasGithubToken: false,
            progressLog: [],
        };
    },

    mounted() {
        this.checkVersion();
        this.$root.getSocket().on("megiaUpdateProgress", this.onProgress);
    },

    beforeUnmount() {
        this.$root.getSocket().off("megiaUpdateProgress", this.onProgress);
    },

    methods: {
        checkVersion() {
            this.checking = true;
            this.checked = false;

            this.$root.getSocket().emit("megiaGetVersion", (res) => {
                this.checking = false;
                this.checked = true;

                if (res.ok) {
                    this.versionData = res.data;
                    this.hasGithubToken = res.data.hasGithubToken || false;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },

        confirmUpdate() {
            this.showConfirm = true;
        },

        applyUpdate() {
            this.showConfirm = false;
            this.updating = true;
            this.progressLog = [];

            this.$root.getSocket().emit("megiaApplyUpdate", (res) => {
                if (!res.ok) {
                    this.updating = false;
                    this.$root.toastError(res.msg);
                }
                // On success, server restarts — connection will drop
            });
        },

        onProgress(event) {
            this.progressLog.push(event);
            this.$nextTick(() => {
                if (this.$refs.logContainer) {
                    this.$refs.logContainer.scrollTop = this.$refs.logContainer.scrollHeight;
                }
            });
        },

        logColor(status) {
            const colors = {
                running: "#60a5fa",
                done: "#4ade80",
                error: "#f87171",
            };
            return colors[status] || "#e5e7eb";
        },

        logIcon(status) {
            const icons = { running: "▶", done: "✓", error: "✗" };
            return icons[status] || "·";
        },
    },
};
</script>
