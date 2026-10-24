window.__ModuleLoader__.load({
  id: '@local/dsh-private-model-routing',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'privateModelRouting'
    /** Host settings entry the Host half declares (its `tags` field is volatile). */
    const SETTINGS_NS = 'private-model-routing'
    /** Provider-card extension seat declared by the Models settings page. */
    const CARD_SLOT = 'settings.models.provider-card'
    /** Adapter namespaces whose cards get the tag editor. */
    const CARD_KEYS = ['llm-pi-ai', 'llm-deepseek']

    const MAX_LABELS = 8
    const MAX_LABEL_LENGTH = 40

    const zh = {
      title: '语义标签',
      hint: 'Agent 会按这些标签挑选子代理模型',
      empty: '这个提供方还没有语义标签。',
      modelLabel: '模型 ID',
      modelPlaceholder: '模型 ID',
      labelsLabel: '标签',
      labelsPlaceholder: '低成本、代码特化、快速…',
      add: '添加',
      removeLabel: '移除标签 {label}',
      readOnly: '设置为只读，无法修改。',
      saveFailed: '保存失败，请重试。',
    }

    const en = {
      title: 'Semantics',
      hint: 'The agent picks subagent models by these tags',
      empty: 'No semantic tags for this provider yet.',
      modelLabel: 'Model ID',
      modelPlaceholder: 'Model ID',
      labelsLabel: 'Tags',
      labelsPlaceholder: 'low-cost, code-specialized, fast…',
      add: 'Add',
      removeLabel: 'Remove tag {label}',
      readOnly: 'Settings are read-only.',
      saveFailed: 'Could not save; try again.',
    }

    const styles = {
      root: {
        marginTop: 12,
        paddingTop: 10,
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      head: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
      title: { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      rows: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 },
      row: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
      model: {
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: 'var(--dsw-alias-label-primary)',
      },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-2)',
        border: '1px solid var(--dsw-alias-border-l1)',
      },
      chipButton: {
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        padding: 0,
        fontSize: 12,
        lineHeight: 1,
      },
      addRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
      input: {
        flex: '1 1 140px',
        minWidth: 120,
        boxSizing: 'border-box',
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
      },
      button: {
        padding: '5px 10px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        fontSize: 12,
      },
      note: { margin: '6px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
      error: { margin: '6px 0 0', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' },
    }

    function parseLabels(raw) {
      const labels = []
      for (const part of String(raw ?? '').split(/[,，;；|、]+/)) {
        const label = part.trim().slice(0, MAX_LABEL_LENGTH)
        if (label.length === 0 || labels.includes(label)) continue
        labels.push(label)
        if (labels.length >= MAX_LABELS) break
      }
      return labels
    }

    function tagsOf(tags, providerId) {
      if (!Array.isArray(tags)) return []
      return tags.filter((tag) => tag !== null && typeof tag === 'object' && tag.provider === providerId)
    }

    function sameTags(left, right) {
      const encode = (tags) => JSON.stringify((Array.isArray(tags) ? tags : []).map((tag) => [tag.provider, tag.model, [...(tag.labels ?? [])]]))
      return encode(left) === encode(right)
    }

    /**
     * Tag editor for one provider card. Writes the whole `tags` array through
     * the shared configuration form, fenced by the revision it rendered.
     */
    function TagsCard(props) {
      const t = props.t
      const providerId = props.provider?.provider ?? ''
      const form = props.form
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form])
      const [snapshot, setSnapshot] = React.useState(getSnapshot)
      React.useEffect(() => {
        setSnapshot(form.getSnapshot())
        return form.subscribe(() => setSnapshot(form.getSnapshot()))
      }, [form])
      const [models, setModels] = React.useState([])
      const [modelId, setModelId] = React.useState('')
      const [labelDraft, setLabelDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const listId = React.useId()

      React.useEffect(() => {
        let alive = true
        props.loadCatalog().then((groups) => {
          if (!alive) return
          const group = (Array.isArray(groups) ? groups : []).find((entry) => entry !== null && typeof entry === 'object' && entry.id === providerId)
          setModels(group !== undefined && Array.isArray(group.models) ? group.models : [])
        })
        return () => {
          alive = false
        }
      }, [props.loadCatalog, providerId])

      if (snapshot.status !== 'ready' || providerId === '') return null

      const tags = Array.isArray(snapshot.value?.tags) ? snapshot.value.tags : []
      const rows = tagsOf(tags, providerId)
      const disabled = snapshot.writable === false || busy

      const writeRows = async (nextRows) => {
        const next = [...tags.filter((tag) => tag === null || typeof tag !== 'object' || tag.provider !== providerId), ...nextRows]
        setBusy(true)
        setError(null)
        try {
          await form.mutate([{ op: 'set', path: ['tags'], value: next }], snapshot.revision)
          const after = form.getSnapshot()
          if (after.status !== 'ready' || !sameTags(after.value?.tags, next)) setError(t('saveFailed'))
        } catch {
          setError(t('saveFailed'))
        } finally {
          setBusy(false)
        }
      }

      const add = () => {
        const model = modelId.trim()
        const labels = parseLabels(labelDraft)
        if (model.length === 0 || labels.length === 0) return
        const existing = rows.find((row) => row.model === model)
        const nextRows = existing === undefined
          ? [...rows, { provider: providerId, model, labels }]
          : rows.map((row) => row.model === model
            ? { ...row, labels: [...new Set([...(row.labels ?? []), ...labels])].slice(0, MAX_LABELS) }
            : row)
        setModelId('')
        setLabelDraft('')
        void writeRows(nextRows)
      }

      const remove = (model, label) => {
        const nextRows = rows
          .map((row) => row.model === model ? { ...row, labels: (row.labels ?? []).filter((item) => item !== label) } : row)
          .filter((row) => Array.isArray(row.labels) && row.labels.length > 0)
        void writeRows(nextRows)
      }

      const canAdd = !disabled && modelId.trim().length > 0 && parseLabels(labelDraft).length > 0

      return h('div', { style: styles.root },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, t('title')),
          h('span', { style: styles.hint }, t('hint')),
        ),
        rows.length === 0
          ? h('p', { style: styles.note }, t('empty'))
          : h('div', { style: styles.rows }, rows.map((row) => h('div', { key: row.model, style: styles.row },
            h('code', { style: styles.model }, row.model),
            (Array.isArray(row.labels) ? row.labels : []).map((label) => h('span', { key: label, style: styles.chip },
              label,
              h('button', {
                type: 'button',
                style: styles.chipButton,
                'aria-label': t('removeLabel', { label }),
                disabled,
                onClick: () => remove(row.model, label),
              }, '×'),
            )),
          ))),
        h('div', { style: styles.addRow },
          h('input', {
            style: styles.input,
            list: listId,
            value: modelId,
            placeholder: t('modelPlaceholder'),
            'aria-label': t('modelLabel'),
            disabled,
            onChange: (event) => setModelId(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (canAdd) add()
              }
            },
          }),
          h('datalist', { id: listId }, models.map((model) => h('option', { key: model.id, value: model.id }, model.name ?? model.id))),
          h('input', {
            style: styles.input,
            value: labelDraft,
            placeholder: t('labelsPlaceholder'),
            'aria-label': t('labelsLabel'),
            disabled,
            onChange: (event) => setLabelDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (canAdd) add()
              }
            },
          }),
          h('button', { type: 'button', style: styles.button, disabled: !canAdd, onClick: add }, t('add')),
        ),
        snapshot.writable === false ? h('p', { style: styles.note }, t('readOnly')) : null,
        error === null ? null : h('p', { role: 'alert', style: styles.error }, error),
      )
    }

    /** Required client services. */
    const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.session']

    /**
     * Mount the tag editor into every provider card of the supported adapter
     * families while the Host serves this plugin's settings namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'private-model-routing: copy dictionaries')

      let catalogGroups
      let catalogPromise
      const loadCatalog = () => {
        if (catalogGroups !== undefined) return Promise.resolve(catalogGroups)
        catalogPromise ??= ctx.remote.session.modelCatalog().then((result) => {
          catalogGroups = result !== null && result !== undefined && result.ok === true && result.value !== undefined && Array.isArray(result.value.groups)
            ? result.value.groups
            : []
          return catalogGroups
        }).catch(() => {
          catalogGroups = []
          return catalogGroups
        })
        return catalogPromise
      }

      ctx.effect(() => ctx.remote.$on('llm/adapters-updated', () => {
        catalogGroups = undefined
        catalogPromise = undefined
      }), 'private-model-routing: invalidate model directory')

      ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NS], () => {
        const form = ctx.configForms.get(SETTINGS_NS)
        const disposers = CARD_KEYS.map((key) => ctx.slots.inject(CARD_SLOT, () => ctx.slots.register({
          name: CARD_SLOT,
          key,
          locale: NS,
          inject: () => ({ form, loadCatalog }),
        }, TagsCard)))
        return () => {
          for (const dispose of disposers) dispose()
        }
      }), 'private-model-routing: models card registration')
    }

    return { inject, apply }
  },
})
