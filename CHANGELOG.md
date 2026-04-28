# Changelog

## v0.0.5

[compare changes](https://github.com/Spreizu/nuxt-jit-prerender/compare/v0.0.4...v0.0.5)

### 🚀 Enhancements

- Add route-level dedup to prevent redundant rendering ([e10af6c](https://github.com/Spreizu/nuxt-jit-prerender/commit/e10af6c))
- Use atomic file operations for static files & cache registry ([c7fc619](https://github.com/Spreizu/nuxt-jit-prerender/commit/c7fc619))
- Enable consuming applications to define before/after generate/invalidate/delete hooks ([eedcdcf](https://github.com/Spreizu/nuxt-jit-prerender/commit/eedcdcf))
- Enable preview mode & migrate server to use h3 ([e8bba47](https://github.com/Spreizu/nuxt-jit-prerender/commit/e8bba47))

### 🩹 Fixes

- Disable api endpoints when preview mode is active ([4eb54ca](https://github.com/Spreizu/nuxt-jit-prerender/commit/4eb54ca))
- Cache keys, static assets serving & _payload.json serving ([8e2080d](https://github.com/Spreizu/nuxt-jit-prerender/commit/8e2080d))
- Formatting and linting ([05f488d](https://github.com/Spreizu/nuxt-jit-prerender/commit/05f488d))

### 💅 Refactors

- Remove filteredByHook attribute ([21f84ec](https://github.com/Spreizu/nuxt-jit-prerender/commit/21f84ec))
- Replace node event handling with h3 sendWebResponse ([69fd609](https://github.com/Spreizu/nuxt-jit-prerender/commit/69fd609))

### 📖 Documentation

- Update README ([6e493b2](https://github.com/Spreizu/nuxt-jit-prerender/commit/6e493b2))
- Update README ([2fdbd83](https://github.com/Spreizu/nuxt-jit-prerender/commit/2fdbd83))

### 🏡 Chore

- Update devDependencies (oxfmt, oxlint, vitest) ([cb038d7](https://github.com/Spreizu/nuxt-jit-prerender/commit/cb038d7))

### ✅ Tests

- Add tests for hooks ([bdd1198](https://github.com/Spreizu/nuxt-jit-prerender/commit/bdd1198))

### ❤️ Contributors

- Elmo Egers <uplaymedia@gmail.com>

## v0.0.4

[compare changes](https://github.com/Spreizu/nuxt-jit-prerender/compare/v0.0.3...v0.0.4)

### 🚀 Enhancements

- Add route deletion functionality ([4fbae2c](https://github.com/Spreizu/nuxt-jit-prerender/commit/4fbae2c))

### ❤️ Contributors

- Elmo Egers <uplaymedia@gmail.com>

## v0.0.3

[compare changes](https://github.com/Spreizu/nuxt-jit-prerender/compare/v0.0.2...v0.0.3)

### 🩹 Fixes

- Ensure nitro-preset is included in dist ([65a4f36](https://github.com/Spreizu/nuxt-jit-prerender/commit/65a4f36))

### 📖 Documentation

- Update README ([aff4ae0](https://github.com/Spreizu/nuxt-jit-prerender/commit/aff4ae0))

### ❤️ Contributors

- Elmo Egers <uplaymedia@gmail.com>

## v0.0.2

### 🚀 Enhancements

- Introduce custom nitro preset for JIT route prerendering and static file generation ([8beb0e3](https://github.com/Spreizu/nuxt-jit-prerender/commit/8beb0e3))
- Implement request context and structured logging with consola ([b3b7369](https://github.com/Spreizu/nuxt-jit-prerender/commit/b3b7369))
- Add cache tags support ([b36dedd](https://github.com/Spreizu/nuxt-jit-prerender/commit/b36dedd))
- Add support for cache tag invalidation and route regeneration ([bd61ec6](https://github.com/Spreizu/nuxt-jit-prerender/commit/bd61ec6))

### 🩹 Fixes

- Ensure output is written to the correct location ([429069e](https://github.com/Spreizu/nuxt-jit-prerender/commit/429069e))
- Return { success: false } when rendering fails ([a2b0a61](https://github.com/Spreizu/nuxt-jit-prerender/commit/a2b0a61))

### 💅 Refactors

- Use NUXT prefix for env variables & rename server startup script ([2f9fdf3](https://github.com/Spreizu/nuxt-jit-prerender/commit/2f9fdf3))

### 📖 Documentation

- Update README ([e58f6d6](https://github.com/Spreizu/nuxt-jit-prerender/commit/e58f6d6))
- Update README to cover updated functionality ([896c3a9](https://github.com/Spreizu/nuxt-jit-prerender/commit/896c3a9))

### 🏡 Chore

- Add initial module code ([e399128](https://github.com/Spreizu/nuxt-jit-prerender/commit/e399128))
- Rename package & use oxlnt, oxfmt ([5b5ad24](https://github.com/Spreizu/nuxt-jit-prerender/commit/5b5ad24))
- Update playground ([de1e29e](https://github.com/Spreizu/nuxt-jit-prerender/commit/de1e29e))
- Add support for test coverage & remove postinstall script ([fd7cf0f](https://github.com/Spreizu/nuxt-jit-prerender/commit/fd7cf0f))

### ✅ Tests

- Add tests for core functionality ([efa56a2](https://github.com/Spreizu/nuxt-jit-prerender/commit/efa56a2))
- Cover added functionality ([b4a8062](https://github.com/Spreizu/nuxt-jit-prerender/commit/b4a8062))

### ❤️ Contributors

- Elmo Egers <uplaymedia@gmail.com>
