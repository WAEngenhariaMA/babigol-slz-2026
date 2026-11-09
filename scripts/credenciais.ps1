$ErrorActionPreference = 'Stop'
$senha = Read-Host 'Senha administrativa (mínimo 16 caracteres)' -AsSecureString
$ponteiro = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($senha)
try {
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) | node -e '
        const fs = require("node:fs");
        const crypto = require("node:crypto");
        const password = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
        if (password.length < 16 || Buffer.byteLength(password) > 256) {
            console.error("Use de 16 caracteres a 256 bytes.");
            process.exit(1);
        }
        const salt = crypto.randomBytes(16);
        const digest = crypto.scryptSync(password, salt, 32, { N: 32768, maxmem: 67108864 });
        console.log("ADMIN_PASSWORD_HASH=scrypt$" + salt.toString("hex") + "$" + digest.toString("hex"));
        console.log("SESSION_SECRET=" + crypto.randomBytes(32).toString("base64url"));
    '
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível gerar as credenciais.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro)
    $senha.Dispose()
}
