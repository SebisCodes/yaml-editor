/**
 * The welcome example and the templates of the New menu.
 *
 * The shared conversion test reads START.code as the editor's example document, so the name
 * START stays.
 */

/** The welcome example, opened on the first visit. */
export const START = {
    name: 'Welcome',
    code: `# Edit the code on the left - the tree in the middle follows.
# Click a key or a value in the tree to change it there; comments stay.
editor: YAML Editor
version: 1.2
free: true
account: null

features:
  - tree with types and counts
  - problems with line and column
  - anchors and aliases
  - convert to JSON, CSV and XML

defaults: &defaults        # an anchor ...
  theme: auto
  indent: 2

settings:
  <<: *defaults            # ... and its alias: the keys are merged in
  shortcuts: {save: Ctrl+S, export: Ctrl+E}

note: |
  A block of text keeps
  its line breaks.
`,
};

/** The templates of the New menu, by the key of their menu item. */
export const TEMPLATES = {
    compose: {
        name: 'Docker Compose',
        code: `services:
  web:
    image: nginx:1.27
    ports:
      - "8080:80"
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
    volumes:
      - data:/var/lib/postgresql/data

volumes:
  data: {}
`,
    },
    workflow: {
        name: 'GitHub workflow',
        code: `name: Tests
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run the tests
        run: |
          npm ci
          npm test
`,
    },
    kubernetes: {
        name: 'Kubernetes',
        code: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector: {app: web}
  ports:
    - port: 80
`,
    },
    openapi: {
        name: 'OpenAPI',
        code: `openapi: 3.1.0
info:
  title: Shop API
  version: 1.0.0
paths:
  /products:
    get:
      summary: List the products
      responses:
        "200":
          description: The products
`,
    },
    table: {
        name: 'Table',
        code: `- id: 1
  name: Apple
  price: 1.2
  organic: true
- id: 2
  name: Bread
  price: 3.5
  organic: false
`,
    },
};

/** The code of a new empty document. */
export const BLANK = '';
