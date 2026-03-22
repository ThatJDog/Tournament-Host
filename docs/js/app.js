let parentDirHandle = null;

const pickDirBtn = document.getElementById('pickDirBtn');
const createBtn = document.getElementById('createBtn');
const openFileBtn = document.getElementById('openFileBtn');
const output = document.getElementById('output');
const projectNameInput = document.getElementById('projectName');

function log(msg) {
  output.textContent = msg;
}

function buildProjectXML(name) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <name>${name}</name>
  <created>${now}</created>
  <version>1.0</version>
  <settings>
    <bracketType>single_elimination</bracketType>
    <maxTeams>16</maxTeams>
  </settings>
</project>
`;
}

pickDirBtn.addEventListener('click', async () => {
  try {
    parentDirHandle = await window.showDirectoryPicker();
    createBtn.disabled = false;
    log("Parent folder selected.");
  } catch (err) {
    log("Folder selection cancelled.");
  }
});

createBtn.addEventListener('click', async () => {
  if (!parentDirHandle) {
    log("Pick a parent folder first.");
    return;
  }

  const projectName = projectNameInput.value.trim();
  if (!projectName) {
    log("Enter a project name.");
    return;
  }

  try {
    // Create / get project directory
    const projectDir = await parentDirHandle.getDirectoryHandle(projectName, { create: true });

    // Create config file
    const fileHandle = await projectDir.getFileHandle("project.xml", { create: true });
    const writable = await fileHandle.createWritable();

    const xml = buildProjectXML(projectName);
    await writable.write(xml);
    await writable.close();

    log(`Project "${projectName}" created with project.xml`);
  } catch (err) {
    console.error(err);
    log("Error creating project.");
  }
});

openFileBtn.addEventListener('click', async () => {
  try {
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'XML Files',
        accept: { 'text/xml': ['.xml'] }
      }],
      multiple: false
    });

    const file = await fileHandle.getFile();
    const text = await file.text();
    log(text);
  } catch (err) {
    log("File open cancelled.");
  }
});