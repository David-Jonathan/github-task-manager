
export class SelfRegisteringSubClass {

    constructor() {
        return this;
    }

    static get valueMap() {
        return this._valueMap;
    }

    static set valueMap(valueMap) {
        this._valueMap = valueMap;
    }

    value(value) {
        let result;
        if (this.valueMap && this.valueMap.has(value)) {
            let replacement = this.valueMap.get(value);
            console.debug('replacing "' + value + '" with "' + replacement + '"');
            result = '"' + replacement + '"';
        } else {
            result = '"' + value + '"';
        }

        return 'swapVars(' + result + ')';
    }

    static get registeredTypes() {
        if (this.hasOwnProperty('_registeredTypeMap')) {
            return this._registeredTypeMap;
        } else {
            this._registeredTypeMap = new Map();
            return this._registeredTypeMap;
        }
    }

    static isRegistered(clazzname) {
        return this.registeredTypes.has(clazzname);
    }

    static register(clazzname, clazz) {
        if (!(this.isRegistered(clazzname) &&
            clazz.prototype instanceof this)) {
            this.registeredTypes.set(clazzname, clazz);
            console.info('Registered ' + this.name + ': ' + clazzname);
        } else {
            console.log('Cannot Register ' + clazzname + ', Invalid Type. Must be a subclass of ' + this.name);
        }
    }

    /**
     * 
     * @param {string} clazzname - Class Name to Create
     * @param {*} options - Object of Options to pass into Class
     */
    static create(clazzname, ...options) {
        if (!clazzname) return null;
        if (!this.registeredTypes.has(clazzname)) {
            console.error('Cannot Create Instance. Unknown Subclass: ' + clazzname);
            return null;
        }

        let clazz = this.registeredTypes.get(clazzname);
        let instance = new clazz(...options);
        return instance;
    }

}