# Decisión tecnológica de base de datos

**Estado:** decisión arquitectónica vigente.  
**Alcance:** persistencia móvil y central de PetCare; no autoriza cambios de
proveedor ni implementación de sincronización.

## 1. Contexto del proyecto

PetCare es una aplicación multiplataforma construida con React Native, Expo y
TypeScript. Un mismo cliente Expo apunta a Android, iOS y Web. SQLite es la
persistencia local y permite que la aplicación lea y escriba sin conexión. El
backend es Node.js, Express y TypeScript. La persistencia central del backend
está definida con PostgreSQL y el destino configurado/documentado es Neon.

El cliente no se conecta directamente a PostgreSQL. Las operaciones remotas
pasan por la API Express, que autentica al usuario y aplica autorización antes
de acceder a datos centrales. Las migraciones PostgreSQL viven en
`api/src/db/migrations/`; las migraciones SQLite viven en
`mobile/src/db/migrations/` y son independientes.

## 2. Necesidades de persistencia

El modelo requiere conservar y proteger:

- Usuarios, credenciales derivadas mediante hash y sesiones autenticadas.
- Mascotas pertenecientes a usuarios, con aislamiento entre propietarios.
- Historial médico y metadatos de adjuntos asociados a mascota y propietario.
- Tareas de cuidado, rutinas y un historial preservado de sus ejecuciones.
- Citas, eventos de calendario y recordatorios, incluidos varios recordatorios
  para un mismo destino cuando corresponda.
- Escrituras locales disponibles offline y futura sincronización bidireccional
  con el servidor.
- Versiones remotas, revisiones locales, operaciones idempotentes,
  dependencias de cola y cursores.
- Detección y resolución explícita de conflictos sin descartar cambios
  pendientes ni sobrescribir datos silenciosamente.
- Integridad referencial y autorización owner-scoped para impedir relaciones
  o lecturas entre cuentas.

Los registros médicos requieren especial cuidado de privacidad. En la primera
versión de sincronización descrita por el diseño, KIRAI y los adjuntos médicos
quedan fuera del protocolo; su exclusión no cambia el modelo local existente
ni implica que las tablas PostgreSQL existentes se eliminen.

## 3. PostgreSQL y MongoDB Atlas

La comparación es cualitativa y se refiere a capacidades de los modelos; no
presupone una carga, configuración o nivel de servicio específico.

| Criterio | PostgreSQL (Neon en la arquitectura actual) | MongoDB Atlas |
|---|---|---|
| Modelo de datos y relaciones | Relacional. Tablas y claves representan usuarios, mascotas, historial, cuidados y agenda con relaciones explícitas. | Orientado a documentos BSON. Es natural representar agregados flexibles; relaciones pueden modelarse mediante documentos embebidos o referencias. |
| Integridad referencial | Claves foráneas, restricciones `CHECK`, `UNIQUE` y transacciones permiten expresar invariantes en la base. La autorización sigue siendo responsabilidad de la API. | Ofrece validación de documentos, índices y transacciones, pero las relaciones entre documentos requieren modelado y validación de la aplicación; no son equivalentes a las FK relacionales. |
| Transacciones | Transacciones ACID para cambios coordinados entre entidades, receipts y feed de sincronización. | Soporta transacciones multidocumento en configuraciones compatibles. El diseño debe considerar el costo y alcance de transaccionar varios documentos frente a un agregado embebido. |
| Consistencia | Adecuado para invariantes relacionales, actualizaciones condicionales por versión y escrituras atómicas del dominio/feed dentro de una transacción. | Adecuado para operaciones de documento y agregados; las garantías entre documentos dependen de la estrategia y uso de transacciones. |
| Sincronización offline-first | No resuelve por sí solo el almacenamiento offline, la cola, los cursores ni la resolución de conflictos. Se integra como servidor autoritativo detrás de una API y un protocolo explícito. | Tampoco resuelve automáticamente la sincronización de SQLite ni los conflictos del dominio. Puede encajar con documentos, pero requiere igualmente diseñar identidad, idempotencia, feed y reconciliación. |
| Consultas y escalabilidad | SQL y joins son apropiados para consultas relacionales y reportes. La escalabilidad concreta depende del esquema, índices, carga, configuración y servicio elegido. | Consultas por documento y agregaciones se adaptan a esquemas de documentos; la escalabilidad concreta depende del patrón de acceso, índices, particionamiento y servicio elegido. |
| Mantenimiento y complejidad | Mantiene alineados el modelo SQLite local y el modelo PostgreSQL relacional. El proyecto ya cuenta con migraciones, constraints y herramientas PostgreSQL. | Un cambio requeriría mantener un segundo modelo, reescribir migraciones/consultas y redefinir integridad, transacciones y representación del feed. Reduce fricción solo si el dominio y los patrones de acceso se benefician realmente de documentos. |
| Costos y alojamiento | Neon ya está integrado/configurado en el proyecto. El costo real depende del uso y del plan desplegado. | Atlas es una alternativa administrada; el costo real depende de configuración, región, almacenamiento, cómputo, transferencia y uso. No se comparan precios ni límites: deben consultarse las páginas oficiales vigentes antes de una decisión. |

Ambos productos evolucionan y ofrecen opciones de alojamiento/configuración.
La tabla no implica que toda carga SQL escale mejor que una carga documental,
ni lo contrario. Una evaluación cuantitativa requeriría datos de uso, consultas
representativas, requisitos operativos y precios oficiales vigentes.

## 4. Decisión arquitectónica

Se conserva la arquitectura siguiente:

1. **SQLite:** fuente de lectura y escritura local para la experiencia
   offline-first en cada instalación.
2. **Neon PostgreSQL:** persistencia central compartida entre dispositivos.
3. **Express:** intermediario único para acceso remoto, autenticación,
   autorización, validación e integración con PostgreSQL.
4. **Cliente móvil:** nunca recibe ni usa la URL o credenciales de PostgreSQL.
   Las operaciones remotas se realizan mediante una API autenticada.
5. **Sincronización:** se implementa en una API autenticada y explícita; no se
   considera resuelta por elegir PostgreSQL, SQLite o MongoDB. El diseño
   vigente separa `local_revision`, `server_version` y
   `acknowledged_local_revision`, y propone operaciones idempotentes, cursor,
   cola offline, tombstones y resolución de conflictos.

Se conserva PostgreSQL porque el dominio contiene relaciones y reglas
owner-scoped importantes, el esquema y las migraciones ya están expresados en
SQL, y el protocolo previsto necesita confirmar de forma transaccional
mutaciones, recibos idempotentes y entradas de feed. PostgreSQL permite
respaldar parte de esas invariantes en constraints y claves foráneas, sin
reemplazar las comprobaciones de autorización de la API.

MongoDB Atlas podría ser ventajoso si una evolución futura demostrara que el
dominio está dominado por agregados autocontenidos con estructuras muy
variables, que la mayoría de las consultas recupera documentos completos, o
que existe un requisito operativo/de producto concreto que favorece su modelo
documental. Esta posibilidad no constituye una decisión de migración ni
implica que MongoDB proporcione automáticamente sincronización offline.

## 5. Consecuencias y alternativas futuras

### Ventajas de mantener la arquitectura actual

- El cliente puede continuar escribiendo localmente sin conexión.
- Hay una sola autoridad central para identidad y recursos remotos; el móvil
  no conoce credenciales de base de datos.
- El modelo relacional refleja relaciones entre propietarios, mascotas,
  registros médicos, tareas y agenda.
- Migraciones versionadas y constraints hacen visibles los cambios de esquema
  y ayudan a detectar incompatibilidades.
- El protocolo puede usar versiones, receipts idempotentes y cursores
  owner-scoped dentro de transacciones.
- Evita por ahora reimplementar acceso a datos, operación y procedimientos de
  recuperación en otro proveedor.

### Costos de cambiar a MongoDB

Una sustitución implicaría revisar y migrar el esquema y datos, reescribir
repositorios y migraciones, trasladar constraints relacionales a validación de
documentos y lógica de aplicación, rediseñar transacciones entre entidades,
conservar aislamiento por propietario, adaptar cursores/receipts/feed y
compatibilizar la cola SQLite. También requeriría pruebas de migración,
reconciliación y rollback, actualización de observabilidad y operación, y
revisión de costos y seguridad del nuevo despliegue. Una migración de base no
debe asociar automáticamente datos locales provisionales con cuentas remotas.

### Cuándo reconsiderar

Reabrir esta decisión solo ante evidencia medible, por ejemplo:

- El modelo evoluciona hacia agregados documentales y las consultas reales
  reducen sustancialmente la complejidad con ese diseño.
- Requisitos de latencia, disponibilidad, escala o operación no se satisfacen
  con la arquitectura y configuración PostgreSQL elegidas.
- Una evaluación comparativa con datos representativos demuestra una mejora
  suficiente para compensar migración, compatibilidad y operación.
- Producto, cumplimiento o estrategia de plataforma exige una alternativa.

La evaluación debe comparar patrones de lectura/escritura reales, límites de
consistencia, costos oficiales vigentes, capacidades de respaldo/recuperación,
seguridad, herramientas y costo total de migración. Debe incluir un plan de
coexistencia o corte, validación de datos y rollback.

### Tecnologías complementarias

Es posible incorporar componentes sin reemplazar PostgreSQL como fuente
central de datos estructurados. Ejemplos sujetos a diseño y aprobación:

- Almacenamiento de objetos para bytes de adjuntos, conservando en PostgreSQL
  metadatos, ownership y referencias.
- Cola de trabajos para tareas asíncronas, manteniendo transacciones y estado
  autoritativo en PostgreSQL.
- Motor de búsqueda, analítica o almacenamiento temporal para necesidades
  específicas, con sincronización y política de retención explícitas.
- Proveedores de IA integrados exclusivamente desde el backend.

Cada complemento requiere límites de datos, permisos, retención y estrategia
de consistencia propios; ninguno cambia el principio de que el cliente móvil
accede a datos remotos mediante la API autenticada.

## Referencias del repositorio

- [Modelo de datos](../data-model.md)
- [Diseño de sincronización Fase 4.1](../sync/phase-4-1-sync-design.md)
- [Plan de migraciones Fase 4.2](../sync/phase-4-2-migration-plan.md)
- [README del proyecto](../../README.md)
